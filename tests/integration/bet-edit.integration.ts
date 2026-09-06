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
import { placeBet } from "@/modules/betting/services/bet-placement.service";
import { editBetRequestSchema } from "@/modules/betting/validators/edit-bet-input";
import { editBet, type EditBetOptions } from "@/modules/betting/services/bet-edit.service";
import { getPlayerBetDetail, listPlayerBets } from "@/modules/betting/services/bet-read.service";

let replica: MongoMemoryReplSet | undefined;
let userId: Types.ObjectId;
let otherId: Types.ObjectId;

const ist = (value: string) => new Date(`${value}+05:30`);
/** Faridabad 2026-09-06: opens 07:00, edit cutoff 16:50, closes 17:50 (IST). */
const OPEN = ist("2026-09-06T12:00:00");
const BEFORE_CUTOFF = ist("2026-09-06T16:49:59");
const AT_CUTOFF = ist("2026-09-06T16:50:00");
const CLOSING_SOON = ist("2026-09-06T17:00:00");
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
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_bet_edit"));
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
  const [a, b] = await User.create([
    { role: "PLAYER", loginId: `edit-player-${playerCounter}`, name: "Edit Player", passwordHash: "test-fixture" },
    { role: "PLAYER", loginId: `edit-other-${playerCounter}`, name: "Other Player", passwordHash: "test-fixture" },
  ]);
  userId = a._id;
  otherId = b._id;
});

function placeReq(over: Record<string, unknown> = {}) {
  return {
    marketSlug: "faridabad",
    entryMethod: "JODI",
    numbers: ["07", "22"],
    stakePaise: 1000,
    clientRequestId: randomUUID(),
    ...over,
  };
}

function editReq(over: Record<string, unknown> = {}) {
  return {
    entryMethod: "JODI",
    numbers: ["07", "22", "48"],
    stakePaise: 1000,
    expectedVersion: 1,
    editRequestId: randomUUID(),
    ...over,
  };
}

function place(request: unknown, clock: () => Date, owner: Types.ObjectId = userId) {
  return placeBet({ userId: owner, request: placeBetRequestSchema.parse(request) }, { clock });
}

function edit(betRef: string, request: unknown, clock: () => Date, options: Partial<EditBetOptions> = {}) {
  return editBet({ userId, betRef, request: editBetRequestSchema.parse(request) }, { clock, ...options });
}

async function fund(amountPaise: number, owner: Types.ObjectId = userId): Promise<void> {
  await mockDeposit({ userId: owner, amountPaise, clientRequestId: randomUUID() });
}

async function balances(owner: Types.ObjectId = userId) {
  const wallet = await Wallet.findOne({ userId: owner }).lean();
  return { available: wallet!.availableBalancePaise, reserved: wallet!.reservedBalancePaise };
}

const rows = (type: string) => WalletTransaction.countDocuments({ userId, type });

// ============================================================================================
// My Bets reads
// ============================================================================================

describe("listPlayerBets — a player sees only their own bets", () => {
  it("returns the caller's bets and never another player's", async () => {
    await fund(1_000_00);
    await fund(1_000_00, otherId);
    const mine = await place(placeReq({ numbers: ["07", "22"] }), clockOf(OPEN));
    await place(placeReq({ numbers: ["11", "33"] }), clockOf(OPEN), otherId);

    const page = await listPlayerBets(userId, {}, OPEN);
    expect(page.bets).toHaveLength(1);
    expect(page.bets[0].id).toBe(mine.bet.id);
    expect(page.bets[0].publicRef).toBe(mine.bet.publicRef);
    expect(page.bets[0]).not.toHaveProperty("userId");
    expect(page.bets[0].canEditNow).toBe(true);

    const otherPage = await listPlayerBets(otherId, {}, OPEN);
    expect(otherPage.bets.map((b) => b.id)).not.toContain(mine.bet.id);
  });
});

describe("listPlayerBets — bounded newest-first pagination", () => {
  it("walks the whole history through the opaque cursor with no gaps or repeats", async () => {
    await fund(1_000_00);
    const placed: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const receipt = await place(placeReq({ numbers: ["07", "22"] }), clockOf(OPEN));
      placed.push(receipt.bet.id);
    }

    const p1 = await listPlayerBets(userId, { limit: 2 }, OPEN);
    expect(p1.bets).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listPlayerBets(userId, { limit: 2, cursor: p1.nextCursor! }, OPEN);
    expect(p2.bets).toHaveLength(2);
    const p3 = await listPlayerBets(userId, { limit: 2, cursor: p2.nextCursor! }, OPEN);
    expect(p3.bets).toHaveLength(1);
    expect(p3.nextCursor).toBeNull();

    const seen = [...p1.bets, ...p2.bets, ...p3.bets].map((b) => b.id);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...placed].sort());
  });

  it("honours the status filter", async () => {
    await fund(1_000_00);
    const a = await place(placeReq({ numbers: ["07", "22"] }), clockOf(OPEN));
    await place(placeReq({ numbers: ["11", "33"] }), clockOf(OPEN));
    await Bet.updateOne({ _id: a.bet.id }, { $set: { status: "LOST" } });

    const active = await listPlayerBets(userId, { status: "ACTIVE" }, OPEN);
    expect(active.bets.map((b) => b.id)).not.toContain(a.bet.id);
    const lost = await listPlayerBets(userId, { status: "LOST" }, OPEN);
    expect(lost.bets.map((b) => b.id)).toEqual([a.bet.id]);
  });
});

describe("getPlayerBetDetail — ownership and shape", () => {
  it("resolves by id handle or publicRef for the owner, 404s for anyone else", async () => {
    await fund(1_000_00);
    const receipt = await place(placeReq(), clockOf(OPEN));

    const byId = await getPlayerBetDetail(userId, receipt.bet.id, OPEN);
    expect(byId.publicRef).toBe(receipt.bet.publicRef);
    expect(byId.revisions).toEqual([]);
    const byRef = await getPlayerBetDetail(userId, receipt.bet.publicRef.toLowerCase(), OPEN);
    expect(byRef.id).toBe(receipt.bet.id);

    await expect(getPlayerBetDetail(otherId, receipt.bet.id, OPEN)).rejects.toMatchObject({ code: "BET_NOT_FOUND" });
    await expect(getPlayerBetDetail(otherId, receipt.bet.publicRef, OPEN)).rejects.toMatchObject({ code: "BET_NOT_FOUND" });
  });
});

// ============================================================================================
// Edit — composition, identity, revisions
// ============================================================================================

describe("editBet — same identity, version advances, revision recorded", () => {
  it("JODI add a selection: v1 → v2, publicRef / id / placedAt / round preserved, one revision", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"], stakePaise: 1000 }), clockOf(OPEN));
    const before = await Bet.findById(placed.bet.id);

    const detail = await edit(placed.bet.id, editReq({ numbers: ["07", "22", "48"], expectedVersion: 1 }), clockOf(OPEN));

    expect(detail.id).toBe(placed.bet.id);
    expect(detail.publicRef).toBe(placed.bet.publicRef);
    expect(detail.version).toBe(2);
    expect(detail.status).toBe("ACTIVE");
    expect(detail.totalSelections).toBe(3);
    expect(detail.totalStakePaise).toBe(3000);
    expect(detail.selections).toEqual([
      { number: "07", stakePaise: 1000 },
      { number: "22", stakePaise: 1000 },
      { number: "48", stakePaise: 1000 },
    ]);
    expect(detail.entryMetadata).toEqual({ numbers: ["07", "22", "48"] });
    expect(detail.payoutMultiplierSnapshot).toBe(90);
    expect(detail.placedAt).toBe(placed.bet.placedAt);
    expect(detail.lastEditedAt).toBe(OPEN.toISOString());

    const after = await Bet.findById(placed.bet.id);
    expect(after!.version).toBe(2);
    expect(after!.clientRequestId).toBe(before!.clientRequestId);
    expect(after!.publicRef).toBe(before!.publicRef);
    expect(after!.marketRoundId.equals(before!.marketRoundId)).toBe(true);
    expect(after!.placedAt.getTime()).toBe(before!.placedAt.getTime());
    expect(after!.payoutMultiplierSnapshot).toBe(90);

    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0]).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      before: { entryMethod: "JODI", totalStakePaise: 2000 },
      after: { entryMethod: "JODI", totalStakePaise: 3000 },
      walletDeltaPaise: -1000,
    });
    expect(detail.revisions[0].before.selections).toEqual([
      { number: "07", stakePaise: 1000 },
      { number: "22", stakePaise: 1000 },
    ]);

    const rev = await BetRevision.findOne({ betId: new Types.ObjectId(placed.bet.id) });
    expect(rev!.editRequestId).toBeTruthy();
    expect(rev!.editedAt.getTime()).toBe(OPEN.getTime());
  });

  it("method change JODI → CROSSING re-runs the shared engine", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"] }), clockOf(OPEN));
    const detail = await edit(
      placed.bet.id,
      { entryMethod: "CROSSING", digits: "428", stakePaise: 1000, expectedVersion: 1, editRequestId: randomUUID() },
      clockOf(OPEN),
    );
    expect(detail.entryMethod).toBe("CROSSING");
    expect(detail.entryMetadata).toEqual({ digits: "428" });
    expect(detail.selections.map((s) => s.number)).toEqual(["44", "42", "48", "24", "22", "28", "84", "82", "88"]);
    expect(detail.totalSelections).toBe(9);
  });

  it("method change JODI → COPY_PASTE", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"] }), clockOf(OPEN));
    const detail = await edit(
      placed.bet.id,
      { entryMethod: "COPY_PASTE", rawInput: "22 15 48", palti: false, stakePaise: 1000, expectedVersion: 1, editRequestId: randomUUID() },
      clockOf(OPEN),
    );
    expect(detail.entryMethod).toBe("COPY_PASTE");
    expect(detail.entryMetadata).toEqual({ rawInput: "22 15 48", palti: false });
    expect(detail.selections.map((s) => s.number)).toEqual(["22", "15", "48"]);
  });

  it("Palti toggle expands the selection set", async () => {
    await fund(1_000_00);
    const placed = await place(
      { marketSlug: "faridabad", entryMethod: "COPY_PASTE", rawInput: "2215489635", palti: false, stakePaise: 1000, clientRequestId: randomUUID() },
      clockOf(OPEN),
    );
    const detail = await edit(
      placed.bet.id,
      { entryMethod: "COPY_PASTE", rawInput: "2215489635", palti: true, stakePaise: 1000, expectedVersion: 1, editRequestId: randomUUID() },
      clockOf(OPEN),
    );
    expect(detail.entryMetadata).toEqual({ rawInput: "2215489635", palti: true });
    expect(detail.selections.map((s) => s.number)).toEqual(["22", "15", "51", "48", "84", "96", "69", "35", "53"]);
    expect(detail.revisions[0].before.selections.map((s) => s.number)).toEqual(["22", "15", "48", "96", "35"]);
  });

  it("preserves leading-zero selections as strings end to end", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"] }), clockOf(OPEN));
    const detail = await edit(placed.bet.id, editReq({ numbers: ["00", "07"], expectedVersion: 1 }), clockOf(OPEN));
    expect(detail.selections).toEqual([
      { number: "00", stakePaise: 1000 },
      { number: "07", stakePaise: 1000 },
    ]);
    const bet = await Bet.findById(placed.bet.id);
    expect(bet!.selections[0].number).toBe("00");
    expect(typeof bet!.selections[0].number).toBe("string");
  });

  it("chains v1 → v2 → v3 with a revision per step and the same publicRef", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"] }), clockOf(OPEN));
    const v2 = await edit(placed.bet.id, editReq({ numbers: ["07", "22", "48"], expectedVersion: 1 }), clockOf(OPEN));
    expect(v2.version).toBe(2);
    const v3 = await edit(placed.bet.id, editReq({ numbers: ["07", "22", "48", "91"], expectedVersion: 2 }), clockOf(OPEN));
    expect(v3.version).toBe(3);
    expect(v3.publicRef).toBe(placed.bet.publicRef);
    expect(v3.revisions.map((r) => r.toVersion)).toEqual([2, 3]);
    expect(await BetRevision.countDocuments({ betId: new Types.ObjectId(placed.bet.id) })).toBe(2);
  });

  it("keeps the original payout multiplier snapshot even after the platform rate changes", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"] }), clockOf(OPEN));
    expect(placed.bet.payoutMultiplierSnapshot).toBe(90);

    await PlatformSettings.updateOne({ key: "platform" }, { $set: { payoutMultiplier: 95 } });
    const detail = await edit(placed.bet.id, editReq({ numbers: ["07", "22", "48"], expectedVersion: 1 }), clockOf(OPEN));
    expect(detail.payoutMultiplierSnapshot).toBe(90);
    expect((await Bet.findById(placed.bet.id))!.payoutMultiplierSnapshot).toBe(90);
  });
});

// ============================================================================================
// Edit — wallet delta (difference only)
// ============================================================================================

describe("editBet — wallet moves only the stake difference", () => {
  it("larger wager debits the difference via BET_EDIT_DEBIT", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22", "48"], stakePaise: 1000 }), clockOf(OPEN)); // ₹30
    expect((await balances()).available).toBe(97_000);

    const detail = await edit(
      placed.bet.id,
      editReq({ numbers: ["07", "22", "48", "91"], stakePaise: 1000, expectedVersion: 1 }), // ₹40
      clockOf(OPEN),
    );
    expect(detail.totalStakePaise).toBe(4000);
    expect((await balances()).available).toBe(96_000); // debited exactly ₹10, not ₹30 + ₹40
    expect(await rows("BET_EDIT_DEBIT")).toBe(1);
    expect(await rows("BET_EDIT_REFUND")).toBe(0);
    expect(await rows("BET_PLACED")).toBe(1);

    const ledger = await WalletTransaction.findOne({ userId, type: "BET_EDIT_DEBIT" }).lean();
    expect(ledger).toMatchObject({ amountPaise: 1000, availableDeltaPaise: -1000, referenceType: "BET" });
    expect(ledger!.referenceId!.toString()).toBe(placed.bet.id);
    expect(ledger!.idempotencyKey).toBe(`BET_EDIT_DEBIT:${placed.bet.id}:v2`);
  });

  it("smaller wager refunds the difference via BET_EDIT_REFUND", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22", "48", "91"], stakePaise: 1000 }), clockOf(OPEN)); // ₹40
    expect((await balances()).available).toBe(96_000);

    await edit(placed.bet.id, editReq({ numbers: ["07", "22"], stakePaise: 1000, expectedVersion: 1 }), clockOf(OPEN)); // ₹20
    expect((await balances()).available).toBe(98_000); // refunded exactly ₹20
    expect(await rows("BET_EDIT_REFUND")).toBe(1);
    expect(await rows("BET_EDIT_DEBIT")).toBe(0);

    const ledger = await WalletTransaction.findOne({ userId, type: "BET_EDIT_REFUND" }).lean();
    expect(ledger!.idempotencyKey).toBe(`BET_EDIT_REFUND:${placed.bet.id}:v2`);
  });

  it("same-total edit writes a revision but no wallet movement", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"], stakePaise: 1000 }), clockOf(OPEN)); // ₹20
    expect((await balances()).available).toBe(98_000);

    const detail = await edit(placed.bet.id, editReq({ numbers: ["48", "91"], stakePaise: 1000, expectedVersion: 1 }), clockOf(OPEN)); // ₹20
    expect((await balances()).available).toBe(98_000);
    expect(await rows("BET_EDIT_DEBIT")).toBe(0);
    expect(await rows("BET_EDIT_REFUND")).toBe(0);
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0].walletDeltaPaise).toBe(0);
    expect(detail.revisions[0].before.selections.map((s) => s.number)).toEqual(["07", "22"]);
    expect(detail.revisions[0].after.selections.map((s) => s.number)).toEqual(["48", "91"]);
  });

  it("an edit that needs more than the available balance rolls back completely", async () => {
    await fund(100); // ₹1
    const placed = await place(placeReq({ numbers: ["07"], stakePaise: 100 }), clockOf(OPEN)); // ₹1, available 0
    expect((await balances()).available).toBe(0);

    await expect(
      edit(placed.bet.id, editReq({ numbers: ["07", "22"], stakePaise: 100, expectedVersion: 1 }), clockOf(OPEN)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    const bet = await Bet.findById(placed.bet.id);
    expect(bet!.version).toBe(1);
    expect(bet!.totalSelections).toBe(1);
    expect(bet!.totalStakePaise).toBe(100);
    expect(await BetRevision.countDocuments({ betId: bet!._id })).toBe(0);
    expect(await rows("BET_EDIT_DEBIT")).toBe(0);
    expect((await balances()).available).toBe(0);
  });
});

// ============================================================================================
// Edit — market-window boundaries (server-authoritative, re-checked in the transaction)
// ============================================================================================

describe("editBet — edit-cutoff boundaries", () => {
  const unchanged = async (betId: string) => {
    const bet = await Bet.findById(betId);
    expect(bet!.version).toBe(1);
    expect(await BetRevision.countDocuments({ betId: bet!._id })).toBe(0);
  };

  it("exactly at the edit cutoff → EDIT_WINDOW_CLOSED, nothing changed", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq(), clockOf(OPEN));
    await expect(edit(placed.bet.id, editReq({ expectedVersion: 1 }), clockOf(AT_CUTOFF))).rejects.toMatchObject({
      code: "EDIT_WINDOW_CLOSED",
    });
    await unchanged(placed.bet.id);
    expect((await balances()).available).toBe(98_000); // only the placement debit; the edit moved nothing
  });

  it("one second before the cutoff → success", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq(), clockOf(OPEN));
    const detail = await edit(placed.bet.id, editReq({ expectedVersion: 1 }), clockOf(BEFORE_CUTOFF));
    expect(detail.version).toBe(2);
  });

  it("during CLOSING_SOON → EDIT_WINDOW_CLOSED", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq(), clockOf(OPEN));
    await expect(edit(placed.bet.id, editReq({ expectedVersion: 1 }), clockOf(CLOSING_SOON))).rejects.toMatchObject({
      code: "EDIT_WINDOW_CLOSED",
    });
    await unchanged(placed.bet.id);
  });

  it("after market close → MARKET_CLOSED", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq(), clockOf(OPEN));
    await expect(edit(placed.bet.id, editReq({ expectedVersion: 1 }), clockOf(AT_CLOSE))).rejects.toMatchObject({
      code: "MARKET_CLOSED",
    });
    await unchanged(placed.bet.id);
  });

  it("disabled market → MARKET_DISABLED", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq(), clockOf(OPEN));
    await Market.updateOne({ slug: "faridabad" }, { $set: { enabled: false } });
    await expect(edit(placed.bet.id, editReq({ expectedVersion: 1 }), clockOf(OPEN))).rejects.toMatchObject({
      code: "MARKET_DISABLED",
    });
    await unchanged(placed.bet.id);
  });

  it("a cutoff crossed between the pre-check and the transaction is caught at the transactional boundary", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq(), clockOf(OPEN));
    // pre-check + doc build see OPEN; the in-transaction re-check sees the cutoff already passed.
    await expect(
      edit(placed.bet.id, editReq({ expectedVersion: 1 }), advancing(OPEN, OPEN, OPEN, AT_CUTOFF)),
    ).rejects.toMatchObject({ code: "EDIT_WINDOW_CLOSED" });
    await unchanged(placed.bet.id);
    expect((await balances()).available).toBe(98_000); // only the placement debit; the edit rolled back
  });
});

// ============================================================================================
// Edit — optimistic concurrency
// ============================================================================================

describe("editBet — optimistic concurrency on version", () => {
  it("two edits racing from version 1: exactly one transitions to v2, the other is STALE_VERSION", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"], stakePaise: 1000 }), clockOf(OPEN));

    const results = await Promise.allSettled([
      edit(placed.bet.id, editReq({ numbers: ["07", "48"], stakePaise: 1000, expectedVersion: 1 }), clockOf(OPEN)),
      edit(placed.bet.id, editReq({ numbers: ["07", "99"], stakePaise: 1000, expectedVersion: 1 }), clockOf(OPEN)),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "STALE_VERSION" });

    const bet = await Bet.findById(placed.bet.id);
    expect(bet!.version).toBe(2);
    expect(await BetRevision.countDocuments({ betId: bet!._id })).toBe(1);
    // both targets keep the ₹20 total, so no wallet movement regardless of which won
    expect(await rows("BET_EDIT_DEBIT")).toBe(0);
    expect(await rows("BET_EDIT_REFUND")).toBe(0);
    expect((await balances()).available).toBe(98_000);
  });

  it("a stale expectedVersion after a prior edit is rejected without a change", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"] }), clockOf(OPEN));
    await edit(placed.bet.id, editReq({ numbers: ["07", "22", "48"], expectedVersion: 1 }), clockOf(OPEN)); // → v2

    await expect(
      edit(placed.bet.id, editReq({ numbers: ["07", "22", "91"], expectedVersion: 1 }), clockOf(OPEN)),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });

    const bet = await Bet.findById(placed.bet.id);
    expect(bet!.version).toBe(2);
    expect(await BetRevision.countDocuments({ betId: bet!._id })).toBe(1);
  });
});

// ============================================================================================
// Edit — editRequestId idempotency
// ============================================================================================

describe("editBet — editRequestId idempotency", () => {
  it("replaying the same successful edit returns the same result, no second wallet movement or version bump", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22", "48"], stakePaise: 1000 }), clockOf(OPEN)); // ₹30
    const editRequestId = randomUUID();
    const req = editReq({ numbers: ["07", "22", "48", "91"], stakePaise: 1000, expectedVersion: 1, editRequestId }); // ₹40

    const first = await edit(placed.bet.id, req, clockOf(OPEN));
    expect(first.version).toBe(2);
    expect((await balances()).available).toBe(96_000);

    const replay = await edit(placed.bet.id, req, clockOf(OPEN));
    expect(replay.version).toBe(2);
    expect(replay.revisions).toHaveLength(1);
    expect((await balances()).available).toBe(96_000);
    expect(await rows("BET_EDIT_DEBIT")).toBe(1);
    expect(await BetRevision.countDocuments({ betId: new Types.ObjectId(placed.bet.id) })).toBe(1);
  });

  it("reusing an editRequestId for a different target wager is DUPLICATE_REQUEST", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"] }), clockOf(OPEN));
    const editRequestId = randomUUID();
    await edit(placed.bet.id, editReq({ numbers: ["07", "22", "48"], expectedVersion: 1, editRequestId }), clockOf(OPEN));

    await expect(
      edit(placed.bet.id, editReq({ numbers: ["07", "22", "91"], expectedVersion: 2, editRequestId }), clockOf(OPEN)),
    ).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });

    const bet = await Bet.findById(placed.bet.id);
    expect(bet!.version).toBe(2);
    expect(await BetRevision.countDocuments({ betId: bet!._id })).toBe(1);
  });

  it("replaying a successful edit AFTER the cutoff still returns the previous result (not EDIT_WINDOW_CLOSED)", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22", "48"], stakePaise: 1000 }), clockOf(OPEN)); // ₹30
    const editRequestId = randomUUID();
    const req = editReq({ numbers: ["07", "22", "48", "91"], stakePaise: 1000, expectedVersion: 1, editRequestId }); // ₹40

    const first = await edit(placed.bet.id, req, clockOf(BEFORE_CUTOFF));
    expect(first.version).toBe(2);
    expect((await balances()).available).toBe(96_000);

    const replay = await edit(placed.bet.id, req, clockOf(AT_CLOSE));
    expect(replay.version).toBe(2);
    expect((await balances()).available).toBe(96_000);
    expect(await rows("BET_EDIT_DEBIT")).toBe(1);

    // a brand-new editRequestId after the cutoff still fails normally
    await expect(
      edit(placed.bet.id, editReq({ numbers: ["07"], stakePaise: 1000, expectedVersion: 2 }), clockOf(AT_CLOSE)),
    ).rejects.toMatchObject({ code: "MARKET_CLOSED" });
  });
});

// ============================================================================================
// Edit — atomic rollback + scope guard
// ============================================================================================

describe("editBet — atomicity and scope", () => {
  it("a failure after the wallet movement rolls the whole transaction back", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"], stakePaise: 1000 }), clockOf(OPEN)); // ₹20
    expect((await balances()).available).toBe(98_000);

    await expect(
      edit(placed.bet.id, editReq({ numbers: ["07", "22", "48", "91"], stakePaise: 1000, expectedVersion: 1 }), clockOf(OPEN), {
        afterWalletMovement: () => {
          throw new Error("forced post-movement failure");
        },
      }),
    ).rejects.toThrow("forced post-movement failure");

    expect((await balances()).available).toBe(98_000); // debit rolled back
    const bet = await Bet.findById(placed.bet.id);
    expect(bet!.version).toBe(1);
    expect(bet!.totalStakePaise).toBe(2000);
    expect(await BetRevision.countDocuments({ betId: bet!._id })).toBe(0);
    expect(await rows("BET_EDIT_DEBIT")).toBe(0);
  });

  it("touches only bets, betRevisions, wallet and the BET_EDIT_* ledger — no withdrawal / win / settlement", async () => {
    await fund(1_000_00);
    const placed = await place(placeReq({ numbers: ["07", "22"], stakePaise: 1000 }), clockOf(OPEN));
    await edit(placed.bet.id, editReq({ numbers: ["07", "22", "48"], expectedVersion: 1 }), clockOf(OPEN));
    await edit(placed.bet.id, editReq({ numbers: ["07", "22"], expectedVersion: 2 }), clockOf(OPEN));

    expect(await Withdrawal.countDocuments()).toBe(0);
    expect(await WalletTransaction.countDocuments({ type: "WIN_CREDIT" })).toBe(0);
    expect(await WalletTransaction.countDocuments({ type: { $in: ["WITHDRAWAL_RESERVED", "WITHDRAWAL_RELEASED", "WITHDRAWAL_APPROVED"] } })).toBe(0);
    expect(await MarketRound.countDocuments({ settlementStatus: { $ne: "PENDING" } })).toBe(0);

    const bet = await Bet.findById(placed.bet.id);
    expect(bet!.status).toBe("ACTIVE");
    expect(bet!.winningNumber == null).toBe(true);
    expect(bet!.payoutPaise == null).toBe(true);
    expect(bet!.settledAt == null).toBe(true);
    expect(bet!.version).toBe(3);
  });
});
