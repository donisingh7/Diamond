import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "@/lib/db/connection";
import { ensureIndexes } from "@/lib/db/models";
import { seedFoundation } from "@/modules/settings/services/seed-foundation";
import { User } from "@/modules/users/models/user.model";
import { Market } from "@/modules/markets/models/market.model";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { BetRevision } from "@/modules/betting/models/bet-revision.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { Withdrawal } from "@/modules/withdrawals/models/withdrawal.model";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import { mockDeposit } from "@/modules/wallet/services/mock-deposit.service";
import { placeBetRequestSchema } from "@/modules/betting/validators/place-bet-input";
import { businessDateRefComponent } from "@/modules/betting/services/public-ref";
import { placeBet, type PlaceBetOptions } from "@/modules/betting/services/bet-placement.service";

let replica: MongoMemoryReplSet | undefined;
let userId: Types.ObjectId;

const ist = (value: string) => new Date(`${value}+05:30`);
/** Faridabad 2026-09-06: opens 07:00, edit cutoff 16:50, closes 17:50 (IST). */
const BEFORE_OPEN = ist("2026-09-06T06:00:00");
const AT_OPEN = ist("2026-09-06T07:00:00");
const OPEN = ist("2026-09-06T12:00:00");
const CLOSING_SOON = ist("2026-09-06T17:00:00"); // after edit cutoff, before close
const AT_CLOSE = ist("2026-09-06T17:50:00");

const clockOf = (when: Date) => () => when;
const advancing = (...values: Date[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_placement"));
  vi.stubEnv("SESSION_SECRET", "test-only-secret-with-at-least-32-characters");
  await connectDatabase();
  await ensureIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
  vi.unstubAllEnvs();
});

let playerCounter = 0;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Market.deleteMany({}),
    MarketRound.deleteMany({}),
    Bet.deleteMany({}),
    BetRevision.deleteMany({}),
    Wallet.deleteMany({}),
    WalletTransaction.deleteMany({}),
    Withdrawal.deleteMany({}),
    PlatformSettings.deleteMany({}),
  ]);
  await seedFoundation();
  playerCounter += 1;
  const user = await User.create({
    role: "PLAYER",
    loginId: `placement-player-${playerCounter}`,
    name: "Placement Player",
    passwordHash: "test-fixture",
  });
  userId = user._id;
});

function jodiReq(over: Record<string, unknown> = {}) {
  return {
    marketSlug: "faridabad",
    entryMethod: "JODI",
    numbers: ["07", "22", "48"],
    stakePaise: 1000,
    clientRequestId: randomUUID(),
    ...over,
  };
}

function place(request: unknown, clock: () => Date, options: Partial<PlaceBetOptions> = {}) {
  return placeBet({ userId, request: placeBetRequestSchema.parse(request) }, { clock, ...options });
}

async function fund(amountPaise: number): Promise<void> {
  await mockDeposit({ userId, amountPaise, clientRequestId: randomUUID() });
}

async function balances() {
  const wallet = await Wallet.findOne({ userId }).lean();
  return { available: wallet!.availableBalancePaise, reserved: wallet!.reservedBalancePaise };
}

const betPlacedRows = () => WalletTransaction.countDocuments({ userId, type: "BET_PLACED" });

// ---------------------------------------------------------------------------------------------

describe("placeBet — successful placement persists the canonical wager", () => {
  it("JODI: ACTIVE version-1 bet, human publicRef, exact selections, snapshot, round link", async () => {
    await fund(1_000_00);
    const request = jodiReq();
    const receipt = await place(request, clockOf(OPEN));

    expect(receipt.bet.publicRef).toMatch(/^FB-0906-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    expect(receipt.bet.market).toEqual({ name: "Faridabad", slug: "faridabad", code: "FB" });
    expect(receipt.bet.businessDate).toBe("2026-09-06");
    expect(receipt.bet.entryMethod).toBe("JODI");
    expect(receipt.bet.entryMetadata).toEqual({ numbers: ["07", "22", "48"] });
    expect(receipt.bet.selections).toEqual([
      { number: "07", stakePaise: 1000 },
      { number: "22", stakePaise: 1000 },
      { number: "48", stakePaise: 1000 },
    ]);
    expect(receipt.bet.totalSelections).toBe(3);
    expect(receipt.bet.totalStakePaise).toBe(3000);
    expect(receipt.bet.payoutMultiplierSnapshot).toBe(90);
    expect(receipt.bet.status).toBe("ACTIVE");
    expect(receipt.bet.version).toBe(1);
    expect(receipt.bet.canEditNow).toBe(true);
    expect(receipt.bet.placedAt).toBe(OPEN.toISOString());
    expect(receipt.serverNow).toBe(OPEN.toISOString());
    expect(receipt.wallet).toEqual({ currency: "INR", availableBalancePaise: 97_000, reservedBalancePaise: 0 });

    // the receipt never leaks the request id or Mongo foreign keys
    expect(receipt.bet).not.toHaveProperty("clientRequestId");
    expect(receipt.bet).not.toHaveProperty("marketId");
    expect(receipt.bet).not.toHaveProperty("marketRoundId");
    expect(receipt.bet).not.toHaveProperty("userId");

    const bet = await Bet.findById(receipt.bet.id);
    expect(bet).not.toBeNull();
    expect(bet!.status).toBe("ACTIVE");
    expect(bet!.version).toBe(1);
    expect(bet!.clientRequestId).toBe(request.clientRequestId);
    expect(bet!.selections.map((s: { number: string }) => s.number)).toEqual(["07", "22", "48"]);

    const fb = await Market.findOne({ slug: "faridabad" });
    const round = await MarketRound.findOne({ marketId: fb!._id, businessDate: "2026-09-06" });
    expect(bet!.marketRoundId.equals(round!._id)).toBe(true);
  });

  it("wallet debit is exact, ledgered once as BET_PLACED, and references the bet", async () => {
    await fund(50_000);
    const receipt = await place(jodiReq({ numbers: ["07", "22", "48"], stakePaise: 1000 }), clockOf(OPEN));

    expect((await balances()).available).toBe(47_000);
    expect(await betPlacedRows()).toBe(1);

    const row = await WalletTransaction.findOne({ userId, type: "BET_PLACED" }).lean();
    expect(row).toMatchObject({
      amountPaise: 3000,
      availableDeltaPaise: -3000,
      reservedDeltaPaise: 0,
      availableBeforePaise: 50_000,
      availableAfterPaise: 47_000,
      referenceType: "BET",
    });
    expect(row!.referenceId!.toString()).toBe(receipt.bet.id);
    expect(row!.idempotencyKey).toBe(`BET_PLACED:${receipt.bet.id}`);
  });

  it("leaves reserved balance untouched", async () => {
    await fund(1_000_00);
    await Wallet.updateOne({ userId }, { $set: { reservedBalancePaise: 2000 } });
    const receipt = await place(jodiReq({ stakePaise: 1000 }), clockOf(OPEN));
    expect(receipt.wallet.reservedBalancePaise).toBe(2000);
    expect(await balances()).toEqual({ available: 97_000, reserved: 2000 });
  });

  it("CROSSING 4428 → 9 canonical selections, debit = 9 × stake (no parser divergence)", async () => {
    await fund(1_000_00);
    const receipt = await place(
      { marketSlug: "faridabad", entryMethod: "CROSSING", digits: "4428", stakePaise: 1000, clientRequestId: randomUUID() },
      clockOf(OPEN),
    );
    expect(receipt.bet.totalSelections).toBe(9);
    expect(receipt.bet.totalStakePaise).toBe(9000);
    expect(receipt.bet.entryMetadata).toEqual({ digits: "4428" });
    expect((await balances()).available).toBe(91_000);
    expect((await WalletTransaction.findOne({ userId, type: "BET_PLACED" }).lean())!.amountPaise).toBe(9000);
  });

  it("COPY_PASTE + Palti persists the exact shared-engine sequence", async () => {
    await fund(1_000_00);
    const receipt = await place(
      {
        marketSlug: "faridabad",
        entryMethod: "COPY_PASTE",
        rawInput: "2215489635",
        palti: true,
        stakePaise: 1000,
        clientRequestId: randomUUID(),
      },
      clockOf(OPEN),
    );
    expect(receipt.bet.selections.map((s) => s.number)).toEqual([
      "22", "15", "51", "48", "84", "96", "69", "35", "53",
    ]);
    expect(receipt.bet.entryMetadata).toEqual({ rawInput: "2215489635", palti: true });
    expect(receipt.bet.totalStakePaise).toBe(9000);
  });

  it("preserves leading-zero selections as strings end to end", async () => {
    await fund(1_000_00);
    const receipt = await place(jodiReq({ numbers: ["00", "07"] }), clockOf(OPEN));
    expect(receipt.bet.selections).toEqual([
      { number: "00", stakePaise: 1000 },
      { number: "07", stakePaise: 1000 },
    ]);
    const bet = await Bet.findById(receipt.bet.id);
    expect(bet!.selections[0].number).toBe("00");
    expect(typeof bet!.selections[0].number).toBe("string");
  });
});

describe("placeBet — multiplier snapshot is taken at placement, never recomputed", () => {
  it("new bets use the current rate; an existing bet keeps its snapshot when the rate changes again", async () => {
    await fund(1_000_00);
    const first = await place(jodiReq({ stakePaise: 1000 }), clockOf(OPEN));
    expect(first.bet.payoutMultiplierSnapshot).toBe(90);

    await PlatformSettings.updateOne({ key: "platform" }, { $set: { payoutMultiplier: 95 } });
    const second = await place(jodiReq({ stakePaise: 1000 }), clockOf(OPEN));
    expect(second.bet.payoutMultiplierSnapshot).toBe(95);

    await PlatformSettings.updateOne({ key: "platform" }, { $set: { payoutMultiplier: 80 } });
    expect((await Bet.findById(first.bet.id))!.payoutMultiplierSnapshot).toBe(90);
    expect((await Bet.findById(second.bet.id))!.payoutMultiplierSnapshot).toBe(95);
  });
});

describe("placeBet — clientRequestId idempotency", () => {
  it("a retry of the same logical wager returns the original bet with no second debit", async () => {
    await fund(1_000_00);
    const request = jodiReq({ stakePaise: 1000 });
    const first = await place(request, clockOf(OPEN));
    const retry = await place(request, clockOf(OPEN));

    expect(retry.bet.id).toBe(first.bet.id);
    expect(retry.bet.publicRef).toBe(first.bet.publicRef);
    expect(await Bet.countDocuments({ userId })).toBe(1);
    expect(await betPlacedRows()).toBe(1);
    expect((await balances()).available).toBe(97_000);
  });

  it("cosmetically different input that normalizes to the same wager is the same request", async () => {
    await fund(1_000_00);
    const clientRequestId = randomUUID();
    const first = await place(
      { marketSlug: "faridabad", entryMethod: "COPY_PASTE", rawInput: "22 15 48", palti: false, stakePaise: 1000, clientRequestId },
      clockOf(OPEN),
    );
    const retry = await place(
      { marketSlug: "faridabad", entryMethod: "COPY_PASTE", rawInput: "22,15,48", palti: false, stakePaise: 1000, clientRequestId },
      clockOf(OPEN),
    );
    expect(retry.bet.id).toBe(first.bet.id);
    expect(await betPlacedRows()).toBe(1);
  });

  it("reusing the id for a DIFFERENT logical wager is DUPLICATE_REQUEST with no second bet or debit", async () => {
    await fund(1_000_00);
    const clientRequestId = randomUUID();
    await place(jodiReq({ numbers: ["07", "22"], stakePaise: 1000, clientRequestId }), clockOf(OPEN));
    await expect(
      place(jodiReq({ numbers: ["07", "99"], stakePaise: 1000, clientRequestId }), clockOf(OPEN)),
    ).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });

    expect(await Bet.countDocuments({ userId })).toBe(1);
    expect(await betPlacedRows()).toBe(1);
  });

  it("two concurrent identical requests place exactly one bet and debit once", async () => {
    await fund(1_000_00);
    const request = jodiReq({ stakePaise: 1000 });
    const results = await Promise.allSettled([
      place(request, clockOf(OPEN)),
      place(request, clockOf(OPEN)),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set(
      results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof placeBet>>>).value.bet.id),
    );
    expect(ids.size).toBe(1);
    expect(await Bet.countDocuments({ userId })).toBe(1);
    expect(await betPlacedRows()).toBe(1);
    expect((await balances()).available).toBe(97_000);
  });

  it("replaying a request after the market has closed returns the original bet, not MARKET_CLOSED", async () => {
    await fund(1_000_00);
    const request = jodiReq({ stakePaise: 1000 });
    const placed = await place(request, clockOf(OPEN));

    const replay = await place(request, clockOf(AT_CLOSE));
    expect(replay.bet.id).toBe(placed.bet.id);
    expect(replay.bet.canEditNow).toBe(false);
    expect(await betPlacedRows()).toBe(1);
    expect((await balances()).available).toBe(97_000);

    // a brand-new request id after close still fails normally
    await expect(place(jodiReq({ stakePaise: 1000 }), clockOf(AT_CLOSE))).rejects.toMatchObject({
      code: "MARKET_CLOSED",
    });
  });
});

describe("placeBet — concurrency and overspend", () => {
  it("two different ₹80 bets against a ₹100 balance: one succeeds, one INSUFFICIENT_BALANCE", async () => {
    await fund(10_000);
    const results = await Promise.allSettled([
      place(jodiReq({ numbers: ["07"], stakePaise: 8000 }), clockOf(OPEN)),
      place(jodiReq({ numbers: ["22"], stakePaise: 8000 }), clockOf(OPEN)),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    expect((await balances()).available).toBe(2000);
    expect(await Bet.countDocuments({ userId })).toBe(1);
    expect(await betPlacedRows()).toBe(1);
  });
});

describe("placeBet — market-window boundaries (server-authoritative)", () => {
  const noWrites = async () => {
    expect(await Bet.countDocuments({ userId })).toBe(0);
    expect(await betPlacedRows()).toBe(0);
  };

  it("before open → MARKET_NOT_OPEN, nothing written", async () => {
    await fund(1_000_00);
    await expect(place(jodiReq(), clockOf(BEFORE_OPEN))).rejects.toMatchObject({ code: "MARKET_NOT_OPEN" });
    expect((await balances()).available).toBe(1_000_00);
    await noWrites();
  });

  it("exactly at open → allowed", async () => {
    await fund(1_000_00);
    const receipt = await place(jodiReq({ stakePaise: 1000 }), clockOf(AT_OPEN));
    expect(receipt.bet.status).toBe("ACTIVE");
  });

  it("CLOSING_SOON (after edit cutoff, before close) → placed, but immediately non-editable", async () => {
    await fund(1_000_00);
    const receipt = await place(jodiReq({ stakePaise: 1000 }), clockOf(CLOSING_SOON));
    expect(receipt.bet.status).toBe("ACTIVE");
    expect(receipt.bet.version).toBe(1);
    expect(receipt.bet.canEditNow).toBe(false);
    expect(await Bet.countDocuments({ userId })).toBe(1);
  });

  it("exactly at close → MARKET_CLOSED, nothing written", async () => {
    await fund(1_000_00);
    await expect(place(jodiReq(), clockOf(AT_CLOSE))).rejects.toMatchObject({ code: "MARKET_CLOSED" });
    expect((await balances()).available).toBe(1_000_00);
    await noWrites();
  });

  it("disabled market → MARKET_DISABLED, nothing written", async () => {
    await fund(1_000_00);
    await Market.updateOne({ slug: "faridabad" }, { $set: { enabled: false } });
    await expect(place(jodiReq(), clockOf(OPEN))).rejects.toMatchObject({ code: "MARKET_DISABLED" });
    await noWrites();
  });

  it("a close that happens between pre-check and the transaction is caught at the transactional boundary", async () => {
    await fund(1_000_00);
    // pre-txn resolution sees OPEN; the in-transaction re-check sees the market already closed.
    await expect(place(jodiReq(), advancing(OPEN, AT_CLOSE))).rejects.toMatchObject({ code: "MARKET_CLOSED" });
    expect((await balances()).available).toBe(1_000_00);
    await noWrites();
  });
});

describe("placeBet — atomicity and rollback", () => {
  it("insufficient available balance → INSUFFICIENT_BALANCE and zero partial writes", async () => {
    await fund(100); // ₹1 only
    await expect(place(jodiReq({ stakePaise: 1000 }), clockOf(OPEN))).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
    expect(await Bet.countDocuments({ userId })).toBe(0);
    expect(await betPlacedRows()).toBe(0);
    expect((await balances()).available).toBe(100);
  });

  it("reserved funds cannot cover a bet", async () => {
    await fund(5000);
    await Wallet.updateOne({ userId }, { $set: { reservedBalancePaise: 50_000 } });
    await expect(place(jodiReq({ stakePaise: 10_000 }), clockOf(OPEN))).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
    expect(await balances()).toEqual({ available: 5000, reserved: 50_000 });
    expect(await Bet.countDocuments({ userId })).toBe(0);
  });

  it("a bet-persistence failure after the wallet debit rolls the whole transaction back", async () => {
    await fund(1_000_00);
    await expect(
      place(jodiReq({ stakePaise: 1000 }), clockOf(OPEN), {
        generatePublicRef: () => {
          throw new Error("forced reference-generation failure");
        },
      }),
    ).rejects.toThrow("forced reference-generation failure");

    expect((await balances()).available).toBe(1_000_00); // debit rolled back
    expect(await betPlacedRows()).toBe(0); // no ledger row
    expect(await Bet.countDocuments({ userId })).toBe(0); // no bet
  });

  it("recovers from a rare publicRef collision with a bounded retry", async () => {
    await fund(1_000_00);
    const first = await place(jodiReq({ stakePaise: 1000 }), clockOf(OPEN));

    let calls = 0;
    const collideTwice = (code: string, date: string) => {
      calls += 1;
      return calls <= 2 ? first.bet.publicRef : `${code}-${businessDateRefComponent(date)}-ZZZZ${calls}`;
    };
    const second = await place(jodiReq({ stakePaise: 1000 }), clockOf(OPEN), { generatePublicRef: collideTwice });
    expect(second.bet.publicRef).not.toBe(first.bet.publicRef);
    expect(await Bet.countDocuments({ userId })).toBe(2);
    expect(await betPlacedRows()).toBe(2);
  });

  it("a persistent publicRef collision fails without a partial write", async () => {
    await fund(1_000_00);
    const first = await place(jodiReq({ stakePaise: 1000 }), clockOf(OPEN));

    await expect(
      place(jodiReq({ stakePaise: 1000 }), clockOf(OPEN), { generatePublicRef: () => first.bet.publicRef }),
    ).rejects.toBeInstanceOf(Error);

    expect(await Bet.countDocuments({ userId })).toBe(1);
    expect(await betPlacedRows()).toBe(1);
    expect((await balances()).available).toBe(97_000); // only the first debit stands
  });
});

describe("placeBet — window scope guard", () => {
  it("touches only bets, wallet and the BET_PLACED ledger — no revision, withdrawal, win or settlement", async () => {
    await fund(1_000_00);
    await place(jodiReq({ stakePaise: 1000 }), clockOf(OPEN));
    await place(
      { marketSlug: "faridabad", entryMethod: "CROSSING", digits: "428935", stakePaise: 1000, clientRequestId: randomUUID() },
      clockOf(OPEN),
    );

    expect(await BetRevision.countDocuments()).toBe(0);
    expect(await Withdrawal.countDocuments()).toBe(0);
    expect(await WalletTransaction.countDocuments({ userId, type: "WIN_CREDIT" })).toBe(0);
    expect(await WalletTransaction.countDocuments({ userId, type: { $in: ["BET_EDIT_DEBIT", "BET_EDIT_REFUND"] } })).toBe(0);
    expect(await MarketRound.countDocuments({ settlementStatus: { $ne: "PENDING" } })).toBe(0);
    expect(await Bet.countDocuments({ userId })).toBe(2);
  });
});
