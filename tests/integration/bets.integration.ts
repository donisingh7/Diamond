import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "@/lib/db/connection";
import { ensureIndexes } from "@/lib/db/models";
import { seedFoundation } from "@/modules/settings/services/seed-foundation";
import { Market } from "@/modules/markets/models/market.model";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import { quoteRequestSchema, type QuoteRequest } from "@/modules/betting/validators/quote-input";
import { quoteBet } from "@/modules/betting/services/quote.service";

let replica: MongoMemoryReplSet | undefined;
const ist = (value: string) => new Date(`${value}+05:30`);

/** Parse through the real request schema, then call the service — exactly the route's path
 *  minus the HTTP/auth wrapper (that is covered by the manual E2E in the verification record). */
function quote(input: unknown, now: Date) {
  return quoteBet(quoteRequestSchema.parse(input) as QuoteRequest, now);
}

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_bets"));
  await connectDatabase();
  await ensureIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await Promise.all([
    Market.deleteMany({}),
    MarketRound.deleteMany({}),
    Bet.deleteMany({}),
    Wallet.deleteMany({}),
    WalletTransaction.deleteMany({}),
    PlatformSettings.deleteMany({}),
  ]);
  await seedFoundation();
});

const OPEN = ist("2026-09-06T12:00:00"); // Faridabad open, well before the 16:50 edit cutoff

describe("quoteBet — calculation", () => {
  it("3 JODI selections at ₹10 → ₹30 total, ₹900 credit per winning selection at 90x", async () => {
    const result = await quote(
      { marketSlug: "faridabad", entryMethod: "JODI", numbers: ["07", "22", "48"], stakePaise: 1000 },
      OPEN,
    );
    expect(result.selections).toEqual([
      { number: "07", stakePaise: 1000 },
      { number: "22", stakePaise: 1000 },
      { number: "48", stakePaise: 1000 },
    ]);
    expect(result.selectionCount).toBe(3);
    expect(result.stakePerSelectionPaise).toBe(1000);
    expect(result.totalStakePaise).toBe(3000);
    expect(result.payoutMultiplier).toBe(90);
    expect(result.perWinningSelectionCreditPaise).toBe(90_000);
    expect(result.currency).toBe("INR");
    expect(result.binding).toBe(false);
  });

  it("CROSSING 428935 at ₹10 → 36 selections, ₹360 total", async () => {
    const result = await quote(
      { marketSlug: "faridabad", entryMethod: "CROSSING", digits: "428935", stakePaise: 1000 },
      OPEN,
    );
    expect(result.selectionCount).toBe(36);
    expect(result.totalStakePaise).toBe(36_000);
    expect(result.engineMetadata).toMatchObject({ uniqueDigitCount: 6 });
  });

  it("COPY_PASTE with Palti → frozen 9-number canonical sequence, palti metadata retained", async () => {
    const result = await quote(
      { marketSlug: "faridabad", entryMethod: "COPY_PASTE", rawInput: "2215489635", palti: true, stakePaise: 1000 },
      OPEN,
    );
    expect(result.selections.map((s) => s.number)).toEqual([
      "22", "15", "51", "48", "84", "96", "69", "35", "53",
    ]);
    expect(result.entryMetadata).toEqual({ rawInput: "2215489635", palti: true });
    expect(result.totalStakePaise).toBe(9000);
  });

  it("names the canonical marketRoundId and business date of the resolved round", async () => {
    const result = await quote(
      { marketSlug: "faridabad", entryMethod: "JODI", numbers: ["07"], stakePaise: 1000 },
      OPEN,
    );
    const round = await MarketRound.findOne({ businessDate: "2026-09-06" }).populate("marketId");
    expect(result.marketRoundId).toBe(round!._id.toString());
    expect(result.businessDate).toBe("2026-09-06");
  });

  it("rejects a stake below ₹1 with STAKE_BELOW_MINIMUM", async () => {
    await expect(
      quoteBet(
        { marketSlug: "faridabad", entryMethod: "JODI", numbers: ["07"], stakePaise: 99 } as QuoteRequest,
        OPEN,
      ),
    ).rejects.toMatchObject({ code: "STAKE_BELOW_MINIMUM" });
  });
});

describe("quoteBet — payout multiplier is configuration-driven (never hardcoded 90)", () => {
  it("uses an updated platformSettings.payoutMultiplier with no code change", async () => {
    await PlatformSettings.updateOne({ key: "platform" }, { $set: { payoutMultiplier: 95 } });
    const result = await quote(
      { marketSlug: "faridabad", entryMethod: "JODI", numbers: ["07"], stakePaise: 1000 },
      OPEN,
    );
    expect(result.payoutMultiplier).toBe(95);
    expect(result.perWinningSelectionCreditPaise).toBe(95_000);
  });
});

describe("quoteBet — server-authoritative market window", () => {
  const req = { marketSlug: "faridabad", entryMethod: "JODI" as const, numbers: ["07"], stakePaise: 1000 };

  it("before open → MARKET_NOT_OPEN", async () => {
    await expect(quote(req, ist("2026-09-06T06:00:00"))).rejects.toMatchObject({ code: "MARKET_NOT_OPEN" });
  });

  it("exactly at open → allowed", async () => {
    await expect(quote(req, ist("2026-09-06T07:00:00"))).resolves.toMatchObject({ marketState: "OPEN" });
  });

  it("during the edit-locked CLOSING_SOON interval → still allowed, but not editable after placing", async () => {
    const result = await quote(req, ist("2026-09-06T17:00:00")); // 16:50 cutoff < now < 17:50 close
    expect(result.marketState).toBe("CLOSING_SOON");
    expect(result.editableAfterPlacing).toBe(false);
  });

  it("exactly at close → MARKET_CLOSED", async () => {
    await expect(quote(req, ist("2026-09-06T17:50:00"))).rejects.toMatchObject({ code: "MARKET_CLOSED" });
  });

  it("disabled market → MARKET_DISABLED", async () => {
    await Market.updateOne({ slug: "faridabad" }, { $set: { enabled: false } });
    await expect(quote(req, OPEN)).rejects.toMatchObject({ code: "MARKET_DISABLED" });
  });

  it("unknown market slug → MARKET_NOT_FOUND", async () => {
    await expect(quote({ ...req, marketSlug: "no-such-market" }, OPEN)).rejects.toMatchObject({
      code: "MARKET_NOT_FOUND",
    });
  });
});

describe("quoteBet — writes nothing financial", () => {
  it("leaves bets, wallets and walletTransactions untouched after a successful quote", async () => {
    const before = await Promise.all([
      Bet.countDocuments(),
      Wallet.countDocuments(),
      WalletTransaction.countDocuments(),
    ]);
    expect(before).toEqual([0, 0, 0]);

    await quote(
      { marketSlug: "faridabad", entryMethod: "CROSSING", digits: "428935", stakePaise: 1000 },
      OPEN,
    );

    const after = await Promise.all([
      Bet.countDocuments(),
      Wallet.countDocuments(),
      WalletTransaction.countDocuments(),
    ]);
    expect(after).toEqual([0, 0, 0]);
  });

  it("is non-binding — repeating an identical quote yields an equivalent result", async () => {
    const input = { marketSlug: "faridabad", entryMethod: "JODI" as const, numbers: ["07", "22"], stakePaise: 1000 };
    const first = await quote(input, OPEN);
    const second = await quote(input, OPEN);
    expect(second.selections).toEqual(first.selections);
    expect(second.totalStakePaise).toBe(first.totalStakePaise);
    expect(second.marketRoundId).toBe(first.marketRoundId);
  });
});
