import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase, withTransaction } from "@/lib/db/connection";
import { ensureIndexes } from "@/lib/db/models";
import { seedFoundation } from "@/modules/settings/services/seed-foundation";
import { User } from "@/modules/users/models/user.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { BetRevision } from "@/modules/betting/models/bet-revision.model";
import { Withdrawal } from "@/modules/withdrawals/models/withdrawal.model";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import {
  createPlayerWallet,
  creditAvailableInSession,
  debitAvailableInSession,
  finalizeReservedInSession,
  getWalletView,
  releaseReservedInSession,
  reserveInSession,
} from "@/modules/wallet/services/wallet.service";
import { mockDeposit } from "@/modules/wallet/services/mock-deposit.service";
import { listWalletTransactions } from "@/modules/wallet/services/wallet-transactions.service";

let replica: MongoMemoryReplSet | undefined;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_wallet"));
  vi.stubEnv("SESSION_SECRET", "test-only-secret-with-at-least-32-characters");
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
    User.deleteMany({}),
    Wallet.deleteMany({}),
    WalletTransaction.deleteMany({}),
    Bet.deleteMany({}),
    BetRevision.deleteMany({}),
    Withdrawal.deleteMany({}),
    PlatformSettings.deleteMany({}),
  ]);
  await seedFoundation();
});

let playerCounter = 0;
async function createPlayer(): Promise<Types.ObjectId> {
  playerCounter += 1;
  const user = await User.create({
    role: "PLAYER",
    loginId: `wallet-player-${playerCounter}`,
    name: "Wallet Player",
    passwordHash: "test-fixture",
  });
  return user._id;
}

/** Fixture-only direct balance seed for isolated concurrency/primitive tests (Window 4A2 brief §41).
 *  Production/business code must never initialise a balance outside a ledgered movement. */
async function seedWallet(
  userId: Types.ObjectId,
  balances: { available?: number; reserved?: number } = {},
): Promise<void> {
  await Wallet.create({
    userId,
    currency: "INR",
    availableBalancePaise: balances.available ?? 0,
    reservedBalancePaise: balances.reserved ?? 0,
  });
}

const key = () => `test:${randomUUID()}`;

async function balances(userId: Types.ObjectId) {
  const wallet = await Wallet.findOne({ userId }).lean();
  return { available: wallet!.availableBalancePaise, reserved: wallet!.reservedBalancePaise };
}

describe("createPlayerWallet", () => {
  it("creates one zero-value wallet and is idempotent", async () => {
    const userId = await createPlayer();
    const first = await createPlayerWallet(userId);
    const second = await createPlayerWallet(userId);
    expect(first._id.toString()).toBe(second._id.toString());
    expect(first.availableBalancePaise).toBe(0);
    expect(first.reservedBalancePaise).toBe(0);
    expect(first.currency).toBe("INR");
    expect(await Wallet.countDocuments({ userId })).toBe(1);
  });

  it("stays single-wallet under concurrent creation", async () => {
    const userId = await createPlayer();
    const created = await Promise.all(Array.from({ length: 8 }, () => createPlayerWallet(userId)));
    const ids = new Set(created.map((wallet) => wallet._id.toString()));
    expect(ids.size).toBe(1);
    expect(await Wallet.countDocuments({ userId })).toBe(1);
  });
});

describe("applyWalletMovement — missing wallet", () => {
  it("is WALLET_NOT_FOUND when the player has no wallet", async () => {
    const userId = await createPlayer();
    await expect(
      withTransaction((session) =>
        creditAvailableInSession({ userId, type: "ADMIN_CREDIT", amountPaise: 100, idempotencyKey: key() }, session),
      ),
    ).rejects.toMatchObject({ code: "WALLET_NOT_FOUND" });
  });
});

describe("concurrency — two racing debits cannot both succeed (brief §30)", () => {
  it("one succeeds, one fails INSUFFICIENT_BALANCE, final balance 2000, exactly one ledger row", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 10_000 });

    const debit = () =>
      withTransaction((session) =>
        debitAvailableInSession(
          { userId, type: "BET_PLACED", amountPaise: 8_000, idempotencyKey: key() },
          session,
        ),
      );

    const results = await Promise.allSettled([debit(), debit()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    const { available } = await balances(userId);
    expect(available).toBe(2_000);
    expect(available).toBeGreaterThanOrEqual(0);
    expect(await WalletTransaction.countDocuments({ userId, type: "BET_PLACED" })).toBe(1);
  });

  it("never lets available go negative even with more racers than the balance allows", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 10_000 });
    const debit = () =>
      withTransaction((session) =>
        debitAvailableInSession(
          { userId, type: "ADMIN_DEBIT", amountPaise: 4_000, idempotencyKey: key() },
          session,
        ),
      ).catch((error: unknown) => error);

    await Promise.all(Array.from({ length: 6 }, debit));
    const { available } = await balances(userId);
    expect(available).toBe(2_000); // exactly two of the six 4000-paise debits fit
    expect(await WalletTransaction.countDocuments({ userId, type: "ADMIN_DEBIT" })).toBe(2);
  });
});

describe("idempotency — mock deposit (brief §31)", () => {
  it("crediting the same clientRequestId twice moves money only once", async () => {
    const userId = await createPlayer();
    const clientRequestId = randomUUID();

    const first = await mockDeposit({ userId, amountPaise: 100, clientRequestId });
    const second = await mockDeposit({ userId, amountPaise: 100, clientRequestId });

    expect(first.transaction.id).toBe(second.transaction.id);
    expect(second.wallet.availableBalancePaise).toBe(100);
    expect(await WalletTransaction.countDocuments({ userId, type: "MOCK_DEPOSIT" })).toBe(1);
    expect((await balances(userId)).available).toBe(100);
  });

  it("reusing a clientRequestId with a different amount is a DUPLICATE_REQUEST conflict with no second movement", async () => {
    const userId = await createPlayer();
    const clientRequestId = randomUUID();
    await mockDeposit({ userId, amountPaise: 100, clientRequestId });

    await expect(mockDeposit({ userId, amountPaise: 200, clientRequestId })).rejects.toMatchObject({
      code: "DUPLICATE_REQUEST",
    });
    expect(await WalletTransaction.countDocuments({ userId })).toBe(1);
    expect((await balances(userId)).available).toBe(100);
  });

  it("two concurrent identical deposits still credit only once", async () => {
    const userId = await createPlayer();
    const clientRequestId = randomUUID();
    const results = await Promise.allSettled([
      mockDeposit({ userId, amountPaise: 500, clientRequestId }),
      mockDeposit({ userId, amountPaise: 500, clientRequestId }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await WalletTransaction.countDocuments({ userId, type: "MOCK_DEPOSIT" })).toBe(1);
    expect((await balances(userId)).available).toBe(500);
  });

  it("applyWalletMovement replays an already-applied key without a second mutation", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 0 });
    const idempotencyKey = key();
    const first = await withTransaction((s) =>
      creditAvailableInSession({ userId, type: "ADMIN_CREDIT", amountPaise: 700, idempotencyKey }, s),
    );
    const replay = await withTransaction((s) =>
      creditAvailableInSession({ userId, type: "ADMIN_CREDIT", amountPaise: 700, idempotencyKey }, s),
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.transactionId.toString()).toBe(first.transactionId.toString());
    expect((await balances(userId)).available).toBe(700);
    expect(await WalletTransaction.countDocuments({ userId })).toBe(1);
  });
});

describe("reserve / release / finalize transitions (brief §32)", () => {
  it("reserve then release returns to the starting balance with matching ledger deltas", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 10_000 });

    const reserved = await withTransaction((s) =>
      reserveInSession({ userId, amountPaise: 3_000, idempotencyKey: key() }, s),
    );
    expect(reserved).toMatchObject({ availableBalancePaise: 7_000, reservedBalancePaise: 3_000 });
    const reserveRow = await WalletTransaction.findOne({ userId, type: "WITHDRAWAL_RESERVED" }).lean();
    expect(reserveRow).toMatchObject({
      availableDeltaPaise: -3_000, reservedDeltaPaise: 3_000,
      availableBeforePaise: 10_000, availableAfterPaise: 7_000,
      reservedBeforePaise: 0, reservedAfterPaise: 3_000,
    });

    const released = await withTransaction((s) =>
      releaseReservedInSession({ userId, amountPaise: 3_000, idempotencyKey: key() }, s),
    );
    expect(released).toMatchObject({ availableBalancePaise: 10_000, reservedBalancePaise: 0 });
    const releaseRow = await WalletTransaction.findOne({ userId, type: "WITHDRAWAL_RELEASED" }).lean();
    expect(releaseRow).toMatchObject({
      availableDeltaPaise: 3_000, reservedDeltaPaise: -3_000,
      availableBeforePaise: 7_000, availableAfterPaise: 10_000,
      reservedBeforePaise: 3_000, reservedAfterPaise: 0,
    });
  });

  it("reserve then finalize leaves available reduced and reserved cleared", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 10_000 });

    await withTransaction((s) => reserveInSession({ userId, amountPaise: 3_000, idempotencyKey: key() }, s));
    const finalized = await withTransaction((s) =>
      finalizeReservedInSession({ userId, amountPaise: 3_000, idempotencyKey: key() }, s),
    );
    expect(finalized).toMatchObject({ availableBalancePaise: 7_000, reservedBalancePaise: 0 });
    const approveRow = await WalletTransaction.findOne({ userId, type: "WITHDRAWAL_APPROVED" }).lean();
    expect(approveRow).toMatchObject({
      availableDeltaPaise: 0, reservedDeltaPaise: -3_000,
      reservedBeforePaise: 3_000, reservedAfterPaise: 0,
    });
  });

  it("guards: cannot reserve more than available, cannot release/finalize more than reserved", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 10_000, reserved: 3_000 });

    await expect(
      withTransaction((s) => reserveInSession({ userId, amountPaise: 20_000, idempotencyKey: key() }, s)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await expect(
      withTransaction((s) => releaseReservedInSession({ userId, amountPaise: 5_000, idempotencyKey: key() }, s)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await expect(
      withTransaction((s) => finalizeReservedInSession({ userId, amountPaise: 5_000, idempotencyKey: key() }, s)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(await balances(userId)).toEqual({ available: 10_000, reserved: 3_000 });
  });

  it("reserved funds are not usable for a debit", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 50, reserved: 500 });
    await expect(
      withTransaction((s) =>
        debitAvailableInSession({ userId, type: "BET_PLACED", amountPaise: 100, idempotencyKey: key() }, s),
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });
});

describe("bet-type primitives are ready for Window 4A3 (brief §33)", () => {
  it("BET_PLACED / BET_EDIT_DEBIT / BET_EDIT_REFUND / WIN_CREDIT move the balance in the right direction", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 100_000 });

    const placed = await withTransaction((s) =>
      debitAvailableInSession({ userId, type: "BET_PLACED", amountPaise: 3_000, idempotencyKey: key() }, s),
    );
    expect(placed.availableBalancePaise).toBe(97_000);

    const editDebit = await withTransaction((s) =>
      debitAvailableInSession({ userId, type: "BET_EDIT_DEBIT", amountPaise: 1_000, idempotencyKey: key() }, s),
    );
    expect(editDebit.availableBalancePaise).toBe(96_000);

    const editRefund = await withTransaction((s) =>
      creditAvailableInSession({ userId, type: "BET_EDIT_REFUND", amountPaise: 500, idempotencyKey: key() }, s),
    );
    expect(editRefund.availableBalancePaise).toBe(96_500);

    const win = await withTransaction((s) =>
      creditAvailableInSession({ userId, type: "WIN_CREDIT", amountPaise: 9_000, idempotencyKey: key() }, s),
    );
    expect(win.availableBalancePaise).toBe(105_500);

    expect(await WalletTransaction.countDocuments({ userId })).toBe(4);
    // BET_EDIT delta may be finer than the 100-paise stake minimum — the ledger allows it.
    expect((await WalletTransaction.findOne({ userId, type: "BET_EDIT_REFUND" }).lean())!.amountPaise).toBe(500);
  });
});

describe("admin-type primitives are ready for Window 6 (brief §34)", () => {
  it("ADMIN_CREDIT and ADMIN_DEBIT work; ADMIN_DEBIT cannot push available negative", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 0 });

    const credit = await withTransaction((s) =>
      creditAvailableInSession(
        { userId, type: "ADMIN_CREDIT", amountPaise: 5_000, idempotencyKey: key(), actorAdminId: new Types.ObjectId() },
        s,
      ),
    );
    expect(credit.availableBalancePaise).toBe(5_000);

    const debit = await withTransaction((s) =>
      debitAvailableInSession(
        { userId, type: "ADMIN_DEBIT", amountPaise: 2_000, idempotencyKey: key(), actorAdminId: new Types.ObjectId() },
        s,
      ),
    );
    expect(debit.availableBalancePaise).toBe(3_000);

    await expect(
      withTransaction((s) =>
        debitAvailableInSession({ userId, type: "ADMIN_DEBIT", amountPaise: 9_999, idempotencyKey: key() }, s),
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect((await balances(userId)).available).toBe(3_000);

    const adminRow = await WalletTransaction.findOne({ userId, type: "ADMIN_CREDIT" }).select("+createdByAdminId").lean();
    expect(adminRow!.createdByAdminId).toBeTruthy();
  });
});

describe("transaction composability / rollback (brief §35)", () => {
  it("a wallet movement rolls back with the caller's transaction — balance unchanged, no ledger row", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 1_000 });
    const idempotencyKey = key();

    await expect(
      withTransaction(async (session) => {
        await creditAvailableInSession({ userId, type: "ADMIN_CREDIT", amountPaise: 5_000, idempotencyKey }, session);
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow("deliberate rollback");

    expect((await balances(userId)).available).toBe(1_000);
    expect(await WalletTransaction.countDocuments({ userId })).toBe(0);
    expect(await WalletTransaction.countDocuments({ idempotencyKey })).toBe(0);
  });

  it("a caller can combine several wallet primitives atomically in one transaction", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 10_000 });
    await withTransaction(async (session) => {
      await debitAvailableInSession({ userId, type: "BET_PLACED", amountPaise: 4_000, idempotencyKey: key() }, session);
      await creditAvailableInSession({ userId, type: "WIN_CREDIT", amountPaise: 1_000, idempotencyKey: key() }, session);
    });
    expect((await balances(userId)).available).toBe(7_000);
    expect(await WalletTransaction.countDocuments({ userId })).toBe(2);
  });
});

describe("mock deposit (brief §13, §36)", () => {
  it("accepts ₹1 (100 paise), credits available and writes one MOCK_DEPOSIT ledger row", async () => {
    const userId = await createPlayer();
    const result = await mockDeposit({ userId, amountPaise: 100, clientRequestId: randomUUID() });
    expect(result.transaction).toMatchObject({ type: "MOCK_DEPOSIT", amountPaise: 100 });
    expect(result.wallet).toMatchObject({ currency: "INR", availableBalancePaise: 100, reservedBalancePaise: 0, totalBalancePaise: 100 });
    const row = await WalletTransaction.findOne({ userId, type: "MOCK_DEPOSIT" }).lean();
    expect(row).toMatchObject({
      amountPaise: 100, availableDeltaPaise: 100, reservedDeltaPaise: 0,
      availableBeforePaise: 0, availableAfterPaise: 100,
    });
  });

  it("has no product maximum (a very large deposit is accepted)", async () => {
    const userId = await createPlayer();
    const big = 5_00_00_00_000; // ₹5 crore
    const result = await mockDeposit({ userId, amountPaise: big, clientRequestId: randomUUID() });
    expect(result.wallet.availableBalancePaise).toBe(big);
  });

  it("rejects 99 paise, a fractional amount, a negative amount and an unsafe integer", async () => {
    const userId = await createPlayer();
    await expect(mockDeposit({ userId, amountPaise: 99, clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(mockDeposit({ userId, amountPaise: 100.5, clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "MONEY_OUT_OF_RANGE" });
    await expect(mockDeposit({ userId, amountPaise: -100, clientRequestId: randomUUID() })).rejects.toBeInstanceOf(Error);
    await expect(mockDeposit({ userId, amountPaise: Number.MAX_SAFE_INTEGER + 3, clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "MONEY_OUT_OF_RANGE" });
    expect(await WalletTransaction.countDocuments({ userId })).toBe(0);
  });

  it("is rejected when mockDepositEnabled is false", async () => {
    const userId = await createPlayer();
    await PlatformSettings.updateOne({ key: "platform" }, { $set: { mockDepositEnabled: false } });
    await expect(mockDeposit({ userId, amountPaise: 100, clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("wallet read APIs (brief §16, §17, §37)", () => {
  it("getWalletView derives total and lazily creates a ₹0 wallet if none exists", async () => {
    const userId = await createPlayer();
    expect(await Wallet.countDocuments({ userId })).toBe(0);
    const view = await getWalletView(userId);
    expect(view).toEqual({ currency: "INR", availableBalancePaise: 0, reservedBalancePaise: 0, totalBalancePaise: 0 });
    expect(await Wallet.countDocuments({ userId })).toBe(1);
  });

  it("lists a player's own transactions newest-first, bounded, and paginates without gaps or overlap", async () => {
    const userId = await createPlayer();
    for (let i = 0; i < 25; i += 1) {
      await mockDeposit({ userId, amountPaise: 100 + i, clientRequestId: randomUUID() });
    }

    const firstPage = await listWalletTransactions(userId, {});
    expect(firstPage.transactions).toHaveLength(20); // default limit
    const createdAts = firstPage.transactions.map((t) => t.createdAt);
    expect([...createdAts].sort((a, b) => (a < b ? 1 : -1))).toEqual(createdAts); // newest first
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listWalletTransactions(userId, { cursor: firstPage.nextCursor! });
    expect(secondPage.transactions).toHaveLength(5);
    expect(secondPage.nextCursor).toBeNull();

    const ids = new Set([...firstPage.transactions, ...secondPage.transactions].map((t) => t.id));
    expect(ids.size).toBe(25);
  });

  it("respects an explicit limit and never exceeds the max", async () => {
    const userId = await createPlayer();
    for (let i = 0; i < 8; i += 1) await mockDeposit({ userId, amountPaise: 100, clientRequestId: randomUUID() });
    expect((await listWalletTransactions(userId, { limit: 3 })).transactions).toHaveLength(3);
    expect((await listWalletTransactions(userId, { limit: 9999 })).transactions).toHaveLength(8);
  });

  it("never returns another player's ledger rows", async () => {
    const [a, b] = [await createPlayer(), await createPlayer()];
    await mockDeposit({ userId: a, amountPaise: 100, clientRequestId: randomUUID() });
    await mockDeposit({ userId: b, amountPaise: 200, clientRequestId: randomUUID() });
    const pageA = await listWalletTransactions(a, {});
    expect(pageA.transactions).toHaveLength(1);
    expect(pageA.transactions[0].amountPaise).toBe(100);
  });

  it("rejects a malformed pagination cursor", async () => {
    const userId = await createPlayer();
    await expect(listWalletTransactions(userId, { cursor: "!!!not-a-cursor!!!" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("DTO rows carry the full before/after/delta detail and no internal metadata", async () => {
    const userId = await createPlayer();
    await mockDeposit({ userId, amountPaise: 12_345, clientRequestId: randomUUID() });
    const [row] = (await listWalletTransactions(userId, {})).transactions;
    expect(row).toMatchObject({
      type: "MOCK_DEPOSIT", amountPaise: 12_345,
      availableDeltaPaise: 12_345, reservedDeltaPaise: 0,
      availableBeforePaise: 0, availableAfterPaise: 12_345,
      reservedBeforePaise: 0, reservedAfterPaise: 0,
    });
    expect(row).not.toHaveProperty("idempotencyKey");
    expect(row).not.toHaveProperty("createdByAdminId");
    expect(row).not.toHaveProperty("walletId");
    expect(row).not.toHaveProperty("userId");
  });
});

describe("window scope guard — no bet / revision / withdrawal writes (brief §39, §40)", () => {
  it("a full wallet exercise touches no bet, revision or withdrawal document", async () => {
    const userId = await createPlayer();
    await seedWallet(userId, { available: 100_000 });

    await mockDeposit({ userId, amountPaise: 5_000, clientRequestId: randomUUID() });
    await withTransaction((s) => debitAvailableInSession({ userId, type: "BET_PLACED", amountPaise: 2_000, idempotencyKey: key() }, s));
    await withTransaction((s) => reserveInSession({ userId, amountPaise: 1_000, idempotencyKey: key() }, s));
    await withTransaction((s) => releaseReservedInSession({ userId, amountPaise: 1_000, idempotencyKey: key() }, s));
    await withTransaction((s) => creditAvailableInSession({ userId, type: "WIN_CREDIT", amountPaise: 9_000, idempotencyKey: key() }, s));

    expect(await Bet.countDocuments()).toBe(0);
    expect(await BetRevision.countDocuments()).toBe(0);
    expect(await Withdrawal.countDocuments()).toBe(0);
  });
});
