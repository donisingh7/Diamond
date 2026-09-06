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
import { createWithdrawalSchema } from "@/modules/withdrawals/validators/withdrawal-input";
import {
  approveWithdrawalByAdmin,
  cancelWithdrawal,
  getPlayerWithdrawalDetail,
  listPlayerWithdrawals,
  rejectWithdrawalByAdmin,
  requestWithdrawal,
  withdrawalApproveKey,
  withdrawalReleaseKey,
  withdrawalReserveKey,
  type WithdrawalMutationOptions,
} from "@/modules/withdrawals/services/withdrawal.service";

let replica: MongoMemoryReplSet | undefined;
let userId: Types.ObjectId;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_withdrawal"));
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
    loginId: `withdrawal-player-${playerCounter}`,
    name: "Withdrawal Player",
    passwordHash: "test-fixture",
  });
  userId = user._id;
});

async function createPlayer(): Promise<Types.ObjectId> {
  playerCounter += 1;
  const user = await User.create({
    role: "PLAYER",
    loginId: `withdrawal-player-${playerCounter}`,
    name: "Withdrawal Player",
    passwordHash: "test-fixture",
  });
  return user._id;
}

async function fund(amountPaise: number, who: Types.ObjectId = userId): Promise<void> {
  await mockDeposit({ userId: who, amountPaise, clientRequestId: randomUUID() });
}

async function balances(who: Types.ObjectId = userId) {
  const wallet = await Wallet.findOne({ userId: who }).lean();
  return { available: wallet!.availableBalancePaise, reserved: wallet!.reservedBalancePaise };
}

function bankBody(over: Record<string, unknown> = {}) {
  const { bank, ...rest } = over;
  return {
    method: "BANK" as const,
    amountPaise: 30_000,
    clientRequestId: randomUUID(),
    bank: {
      accountHolderName: "Ravi Kumar",
      accountNumber: "123456789012",
      confirmAccountNumber: "123456789012",
      ifsc: "HDFC0001234",
      bankName: "HDFC Bank",
      ...(bank as Record<string, unknown> | undefined),
    },
    ...rest,
  };
}

function upiBody(over: Record<string, unknown> = {}) {
  const { upi, ...rest } = over;
  return {
    method: "UPI" as const,
    amountPaise: 30_000,
    clientRequestId: randomUUID(),
    upi: { upiId: "ravikumar@okhdfcbank", ...(upi as Record<string, unknown> | undefined) },
    ...rest,
  };
}

function request(body: unknown, who: Types.ObjectId = userId, options: WithdrawalMutationOptions = {}) {
  return requestWithdrawal({ userId: who, request: createWithdrawalSchema.parse(body) }, options);
}

const reservedRows = (who: Types.ObjectId = userId) =>
  WalletTransaction.countDocuments({ userId: who, type: "WITHDRAWAL_RESERVED" });
const releasedRows = (who: Types.ObjectId = userId) =>
  WalletTransaction.countDocuments({ userId: who, type: "WITHDRAWAL_RELEASED" });
const approvedRows = (who: Types.ObjectId = userId) =>
  WalletTransaction.countDocuments({ userId: who, type: "WITHDRAWAL_APPROVED" });

// =============================================================================================

describe("requestWithdrawal — success moves available → reserved and ledgers it once", () => {
  it("UPI: PENDING withdrawal, exact wallet transition, one WITHDRAWAL_RESERVED row", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 30_000 }));

    expect(receipt.withdrawal).toMatchObject({
      method: "UPI",
      amountPaise: 30_000,
      status: "PENDING",
      destination: { method: "UPI", summary: "ra••@okhdfcbank" },
      rejectionReason: null,
      decidedAt: null,
      cancelledAt: null,
      approvedAt: null,
      rejectedAt: null,
    });
    expect(receipt.withdrawal).not.toHaveProperty("paymentDetails");
    expect(receipt.withdrawal).not.toHaveProperty("userId");
    expect(receipt.wallet).toMatchObject({ availableBalancePaise: 70_000, reservedBalancePaise: 30_000 });
    expect(await balances()).toEqual({ available: 70_000, reserved: 30_000 });

    const row = await WalletTransaction.findOne({ userId, type: "WITHDRAWAL_RESERVED" }).lean();
    expect(row).toMatchObject({
      amountPaise: 30_000,
      availableDeltaPaise: -30_000,
      reservedDeltaPaise: 30_000,
      availableBeforePaise: 1_00_000,
      availableAfterPaise: 70_000,
      reservedBeforePaise: 0,
      reservedAfterPaise: 30_000,
      referenceType: "WITHDRAWAL",
    });
    expect(row!.referenceId!.toString()).toBe(receipt.withdrawal.id);
    expect(row!.idempotencyKey).toBe(withdrawalReserveKey(new Types.ObjectId(receipt.withdrawal.id)));

    const stored = await Withdrawal.findById(receipt.withdrawal.id).select("+paymentDetails").lean();
    expect(stored!.status).toBe("PENDING");
    expect(stored!.paymentDetails).toMatchObject({ upiId: "ravikumar@okhdfcbank" });
    expect(stored!.paymentDetails).not.toHaveProperty("accountNumber");
  });

  it("BANK: masked destination summary, confirmation value never stored", async () => {
    await fund(1_00_000);
    const receipt = await request(bankBody({ amountPaise: 25_000 }));
    expect(receipt.withdrawal.destination).toEqual({ method: "BANK", summary: "HDFC Bank ••••9012" });

    const stored = await Withdrawal.findById(receipt.withdrawal.id).select("+paymentDetails").lean();
    expect(stored!.paymentDetails).toEqual({
      accountHolderName: "Ravi Kumar",
      accountNumber: "123456789012",
      ifsc: "HDFC0001234",
      bankName: "HDFC Bank",
    });
    expect(stored!.paymentDetails).not.toHaveProperty("confirmAccountNumber");
    expect(await balances()).toEqual({ available: 75_000, reserved: 25_000 });
  });

  it("accepts exactly ₹1 (100 paise)", async () => {
    await fund(100);
    const receipt = await request(upiBody({ amountPaise: 100 }));
    expect(receipt.withdrawal.amountPaise).toBe(100);
    expect(await balances()).toEqual({ available: 0, reserved: 100 });
  });

  it("₹1000 available, withdraw ₹300 → available ₹700, reserved ₹300 (frozen example)", async () => {
    await fund(1_000_00);
    await request(upiBody({ amountPaise: 300_00 }));
    expect(await balances()).toEqual({ available: 700_00, reserved: 300_00 });
  });
});

describe("requestWithdrawal — validation & guards", () => {
  it("rejects an account-number confirmation mismatch before any write", async () => {
    await fund(1_00_000);
    expect(() => createWithdrawalSchema.parse(bankBody({ bank: { confirmAccountNumber: "000000000000" } }))).toThrow();
    expect(await Withdrawal.countDocuments()).toBe(0);
    expect(await reservedRows()).toBe(0);
  });

  it("rejects below the ₹1 minimum with INVALID_AMOUNT and no writes", async () => {
    await fund(1_00_000);
    await expect(request(upiBody({ amountPaise: 99 }))).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect(await Withdrawal.countDocuments({ userId })).toBe(0);
    expect(await reservedRows()).toBe(0);
    expect(await balances()).toEqual({ available: 1_00_000, reserved: 0 });
  });

  it("rejects an amount above the available balance with INSUFFICIENT_BALANCE and no writes", async () => {
    await fund(100);
    await expect(request(upiBody({ amountPaise: 200 }))).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(await Withdrawal.countDocuments({ userId })).toBe(0);
    expect(await reservedRows()).toBe(0);
    expect(await balances()).toEqual({ available: 100, reserved: 0 });
  });

  it("reserved funds cannot be withdrawn again", async () => {
    await fund(50_000);
    await request(upiBody({ amountPaise: 40_000 })); // available 10_000, reserved 40_000
    await expect(request(upiBody({ amountPaise: 20_000 }))).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(await balances()).toEqual({ available: 10_000, reserved: 40_000 });
    expect(await Withdrawal.countDocuments({ userId, status: "PENDING" })).toBe(1);
  });

  it("a forced failure right after the reserve rolls the whole transaction back", async () => {
    await fund(1_00_000);
    await expect(
      request(upiBody({ amountPaise: 30_000 }), userId, {
        afterWalletMovement: () => {
          throw new Error("forced rollback");
        },
      }),
    ).rejects.toThrow("forced rollback");
    expect(await Withdrawal.countDocuments({ userId })).toBe(0);
    expect(await reservedRows()).toBe(0);
    expect(await balances()).toEqual({ available: 1_00_000, reserved: 0 });
  });
});

describe("requestWithdrawal — clientRequestId idempotency", () => {
  it("a retry of the same logical request returns the original withdrawal with no second reserve", async () => {
    await fund(1_00_000);
    const body = upiBody({ amountPaise: 30_000 });
    const first = await request(body);
    const retry = await request(body);

    expect(retry.withdrawal.id).toBe(first.withdrawal.id);
    expect(await Withdrawal.countDocuments({ userId })).toBe(1);
    expect(await reservedRows()).toBe(1);
    expect(await balances()).toEqual({ available: 70_000, reserved: 30_000 });
  });

  it("reusing the id for a DIFFERENT payload is DUPLICATE_REQUEST with no second withdrawal or reserve", async () => {
    await fund(1_00_000);
    const clientRequestId = randomUUID();
    await request(upiBody({ amountPaise: 30_000, clientRequestId }));
    await expect(request(upiBody({ amountPaise: 40_000, clientRequestId }))).rejects.toMatchObject({
      code: "DUPLICATE_REQUEST",
    });
    await expect(
      request(bankBody({ amountPaise: 30_000, clientRequestId })),
    ).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });

    expect(await Withdrawal.countDocuments({ userId })).toBe(1);
    expect(await reservedRows()).toBe(1);
  });

  it("two concurrent identical requests create exactly one withdrawal / one reserve / one ledger row", async () => {
    await fund(1_00_000);
    const body = upiBody({ amountPaise: 30_000 });
    const results = await Promise.allSettled([request(body), request(body)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set(
      results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof requestWithdrawal>>>).value.withdrawal.id),
    );
    expect(ids.size).toBe(1);
    expect(await Withdrawal.countDocuments({ userId })).toBe(1);
    expect(await reservedRows()).toBe(1);
    expect(await balances()).toEqual({ available: 70_000, reserved: 30_000 });
  });
});

describe("requestWithdrawal — concurrency / overspend (frozen scenario)", () => {
  it("₹100 available, two concurrent ₹80 withdrawals: one PENDING, one INSUFFICIENT_BALANCE", async () => {
    await fund(10_000);
    const results = await Promise.allSettled([
      request(upiBody({ amountPaise: 8_000 })),
      request(upiBody({ amountPaise: 8_000 })),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    expect(await balances()).toEqual({ available: 2_000, reserved: 8_000 });
    expect(await Withdrawal.countDocuments({ userId, status: "PENDING" })).toBe(1);
    expect(await reservedRows()).toBe(1);
  });
});

describe("player reads — own records only, bounded, newest first", () => {
  it("lists only the caller's own withdrawals", async () => {
    const other = await createPlayer();
    await fund(1_00_000);
    await fund(1_00_000, other);
    await request(upiBody({ amountPaise: 10_000 }));
    await request(upiBody({ amountPaise: 20_000 }), other);

    const mine = await listPlayerWithdrawals(userId, {});
    expect(mine.withdrawals).toHaveLength(1);
    expect(mine.withdrawals[0].amountPaise).toBe(10_000);
  });

  it("paginates newest-first with a stable cursor and no gaps or overlap; optional status filter", async () => {
    await fund(10_00_000);
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const receipt = await request(upiBody({ amountPaise: 1_000 + i }));
      ids.push(receipt.withdrawal.id);
    }
    // cancel three so a status filter has something to narrow
    await cancelWithdrawal({ userId, withdrawalId: ids[0] });
    await cancelWithdrawal({ userId, withdrawalId: ids[1] });

    const firstPage = await listPlayerWithdrawals(userId, { limit: 5 });
    expect(firstPage.withdrawals).toHaveLength(5);
    expect(firstPage.nextCursor).not.toBeNull();
    const created = firstPage.withdrawals.map((w) => w.createdAt);
    expect([...created].sort((a, b) => (a < b ? 1 : -1))).toEqual(created);

    const secondPage = await listPlayerWithdrawals(userId, { limit: 5, cursor: firstPage.nextCursor! });
    const thirdPage = await listPlayerWithdrawals(userId, { limit: 5, cursor: secondPage.nextCursor! });
    const seen = new Set(
      [...firstPage.withdrawals, ...secondPage.withdrawals, ...thirdPage.withdrawals].map((w) => w.id),
    );
    expect(seen.size).toBe(12);
    expect(thirdPage.nextCursor).toBeNull();

    const pending = await listPlayerWithdrawals(userId, { status: "PENDING" });
    expect(pending.withdrawals).toHaveLength(10);
    expect(pending.withdrawals.every((w) => w.status === "PENDING")).toBe(true);
    const cancelled = await listPlayerWithdrawals(userId, { status: "CANCELLED" });
    expect(cancelled.withdrawals).toHaveLength(2);
  });

  it("never exceeds the max limit and rejects a malformed cursor", async () => {
    await fund(1_00_000);
    await request(upiBody({ amountPaise: 1_000 }));
    expect((await listPlayerWithdrawals(userId, { limit: 9999 })).withdrawals).toHaveLength(1);
    await expect(listPlayerWithdrawals(userId, { cursor: "!!!bad!!!" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("detail is owner-only: a foreign or malformed id is an indistinguishable WITHDRAWAL_NOT_FOUND", async () => {
    const other = await createPlayer();
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 10_000 }));

    const mine = await getPlayerWithdrawalDetail(userId, receipt.withdrawal.id);
    expect(mine.id).toBe(receipt.withdrawal.id);

    await expect(getPlayerWithdrawalDetail(other, receipt.withdrawal.id)).rejects.toMatchObject({
      code: "WITHDRAWAL_NOT_FOUND",
    });
    await expect(getPlayerWithdrawalDetail(userId, "not-a-real-id")).rejects.toMatchObject({
      code: "WITHDRAWAL_NOT_FOUND",
    });
    await expect(getPlayerWithdrawalDetail(userId, new Types.ObjectId().toHexString())).rejects.toMatchObject({
      code: "WITHDRAWAL_NOT_FOUND",
    });
  });
});

describe("cancelWithdrawal — releases reserved funds exactly once", () => {
  it("PENDING → CANCELLED restores available and writes one WITHDRAWAL_RELEASED row with exact deltas", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 30_000 }));
    expect(await balances()).toEqual({ available: 70_000, reserved: 30_000 });

    const cancelled = await cancelWithdrawal({ userId, withdrawalId: receipt.withdrawal.id });
    expect(cancelled.withdrawal.status).toBe("CANCELLED");
    expect(cancelled.withdrawal.cancelledAt).not.toBeNull();
    expect(cancelled.wallet).toMatchObject({ availableBalancePaise: 1_00_000, reservedBalancePaise: 0 });
    expect(await balances()).toEqual({ available: 1_00_000, reserved: 0 });

    const row = await WalletTransaction.findOne({ userId, type: "WITHDRAWAL_RELEASED" }).lean();
    expect(row).toMatchObject({
      amountPaise: 30_000,
      availableDeltaPaise: 30_000,
      reservedDeltaPaise: -30_000,
      availableBeforePaise: 70_000,
      availableAfterPaise: 1_00_000,
      reservedBeforePaise: 30_000,
      reservedAfterPaise: 0,
      referenceType: "WITHDRAWAL",
    });
    expect(row!.referenceId!.toString()).toBe(receipt.withdrawal.id);
    expect(row!.idempotencyKey).toBe(withdrawalReleaseKey(new Types.ObjectId(receipt.withdrawal.id)));
    expect(await Withdrawal.countDocuments({ _id: receipt.withdrawal.id })).toBe(1); // not deleted
  });

  it("a second cancel is a no-op that returns the CANCELLED withdrawal without a second release", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 30_000 }));
    await cancelWithdrawal({ userId, withdrawalId: receipt.withdrawal.id });
    const again = await cancelWithdrawal({ userId, withdrawalId: receipt.withdrawal.id });

    expect(again.withdrawal.status).toBe("CANCELLED");
    expect(await releasedRows()).toBe(1);
    expect(await balances()).toEqual({ available: 1_00_000, reserved: 0 });
  });

  it("two concurrent cancels release the reserved funds exactly once, never negative", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 30_000 }));

    const results = await Promise.allSettled([
      cancelWithdrawal({ userId, withdrawalId: receipt.withdrawal.id }),
      cancelWithdrawal({ userId, withdrawalId: receipt.withdrawal.id }),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of results) {
      if (r.status === "fulfilled") expect(r.value.withdrawal.status).toBe("CANCELLED");
    }

    expect(await releasedRows()).toBe(1);
    const { available, reserved } = await balances();
    expect(available).toBe(1_00_000);
    expect(reserved).toBe(0);
    expect(reserved).toBeGreaterThanOrEqual(0);
    expect(await Withdrawal.countDocuments({ userId, status: "CANCELLED" })).toBe(1);
  });

  it("cannot cancel an APPROVED or REJECTED withdrawal (deterministic WITHDRAWAL_NOT_PENDING)", async () => {
    await fund(1_00_000);
    const approved = await request(upiBody({ amountPaise: 10_000 }));
    await approveWithdrawalByAdmin({ withdrawalId: new Types.ObjectId(approved.withdrawal.id), adminId: new Types.ObjectId() });
    await expect(cancelWithdrawal({ userId, withdrawalId: approved.withdrawal.id })).rejects.toMatchObject({
      code: "WITHDRAWAL_NOT_PENDING",
    });

    const rejected = await request(upiBody({ amountPaise: 10_000 }));
    await rejectWithdrawalByAdmin({
      withdrawalId: new Types.ObjectId(rejected.withdrawal.id),
      adminId: new Types.ObjectId(),
      reason: "Bank details invalid",
    });
    await expect(cancelWithdrawal({ userId, withdrawalId: rejected.withdrawal.id })).rejects.toMatchObject({
      code: "WITHDRAWAL_NOT_PENDING",
    });
  });

  it("a forced failure right after the release rolls back — withdrawal stays PENDING, funds still reserved", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 30_000 }));
    await expect(
      cancelWithdrawal({ userId, withdrawalId: receipt.withdrawal.id }, {
        afterWalletMovement: () => {
          throw new Error("forced rollback");
        },
      }),
    ).rejects.toThrow("forced rollback");

    expect(await releasedRows()).toBe(0);
    expect(await balances()).toEqual({ available: 70_000, reserved: 30_000 });
    expect((await Withdrawal.findById(receipt.withdrawal.id).lean())!.status).toBe("PENDING");
  });

  it("a foreign player cannot cancel someone else's withdrawal", async () => {
    const other = await createPlayer();
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 10_000 }));
    await expect(cancelWithdrawal({ userId: other, withdrawalId: receipt.withdrawal.id })).rejects.toMatchObject({
      code: "WITHDRAWAL_NOT_FOUND",
    });
    expect((await Withdrawal.findById(receipt.withdrawal.id).lean())!.status).toBe("PENDING");
  });
});

describe("FUTURE ADMIN primitives (not routed in 5A) — approve / reject", () => {
  it("approve: PENDING → APPROVED, reserved cleared, available UNCHANGED, one WITHDRAWAL_APPROVED row", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 30_000 }));
    const adminId = new Types.ObjectId();

    const approved = await approveWithdrawalByAdmin({ withdrawalId: new Types.ObjectId(receipt.withdrawal.id), adminId });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedAt).not.toBeNull();
    expect(await balances()).toEqual({ available: 70_000, reserved: 0 });

    const row = await WalletTransaction.findOne({ userId, type: "WITHDRAWAL_APPROVED" }).lean();
    expect(row).toMatchObject({
      amountPaise: 30_000,
      availableDeltaPaise: 0,
      reservedDeltaPaise: -30_000,
      reservedBeforePaise: 30_000,
      reservedAfterPaise: 0,
    });
    expect(row!.idempotencyKey).toBe(withdrawalApproveKey(new Types.ObjectId(receipt.withdrawal.id)));
    const stored = await Withdrawal.findById(receipt.withdrawal.id).select("+decidedByAdminId").lean();
    expect(stored!.decidedByAdminId!.toString()).toBe(adminId.toString());
  });

  it("approve is idempotent — a repeat returns the APPROVED withdrawal with no second movement", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 30_000 }));
    const id = new Types.ObjectId(receipt.withdrawal.id);
    await approveWithdrawalByAdmin({ withdrawalId: id, adminId: new Types.ObjectId() });
    const again = await approveWithdrawalByAdmin({ withdrawalId: id, adminId: new Types.ObjectId() });
    expect(again.status).toBe("APPROVED");
    expect(await approvedRows()).toBe(1);
    expect(await balances()).toEqual({ available: 70_000, reserved: 0 });
  });

  it("reject: PENDING → REJECTED with a stored reason, funds released, one WITHDRAWAL_RELEASED row", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 30_000 }));

    const rejected = await rejectWithdrawalByAdmin({
      withdrawalId: new Types.ObjectId(receipt.withdrawal.id),
      adminId: new Types.ObjectId(),
      reason: "Name mismatch with KYC",
    });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Name mismatch with KYC");
    expect(rejected.rejectedAt).not.toBeNull();
    expect(await balances()).toEqual({ available: 1_00_000, reserved: 0 });
    expect(await releasedRows()).toBe(1);
    const row = await WalletTransaction.findOne({ userId, type: "WITHDRAWAL_RELEASED" }).lean();
    expect(row).toMatchObject({ amountPaise: 30_000, availableDeltaPaise: 30_000, reservedDeltaPaise: -30_000 });
  });

  it("reject requires a non-empty reason", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 10_000 }));
    await expect(
      rejectWithdrawalByAdmin({ withdrawalId: new Types.ObjectId(receipt.withdrawal.id), adminId: new Types.ObjectId(), reason: "   " }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await Withdrawal.findById(receipt.withdrawal.id).lean())!.status).toBe("PENDING");
    expect(await releasedRows()).toBe(0);
  });

  it("a cancelled withdrawal can no longer be approved or rejected (mutually exclusive terminal transition)", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 10_000 }));
    await cancelWithdrawal({ userId, withdrawalId: receipt.withdrawal.id });
    const id = new Types.ObjectId(receipt.withdrawal.id);
    await expect(approveWithdrawalByAdmin({ withdrawalId: id, adminId: new Types.ObjectId() })).rejects.toMatchObject({
      code: "WITHDRAWAL_NOT_PENDING",
    });
    await expect(
      rejectWithdrawalByAdmin({ withdrawalId: id, adminId: new Types.ObjectId(), reason: "too late" }),
    ).rejects.toMatchObject({ code: "WITHDRAWAL_NOT_PENDING" });
    expect(await releasedRows()).toBe(1); // only the cancel's release
    expect(await approvedRows()).toBe(0);
  });

  it("a forced failure right after the approve movement rolls back — withdrawal stays PENDING", async () => {
    await fund(1_00_000);
    const receipt = await request(upiBody({ amountPaise: 30_000 }));
    await expect(
      approveWithdrawalByAdmin({ withdrawalId: new Types.ObjectId(receipt.withdrawal.id), adminId: new Types.ObjectId() }, {
        afterWalletMovement: () => {
          throw new Error("forced rollback");
        },
      }),
    ).rejects.toThrow("forced rollback");
    expect(await approvedRows()).toBe(0);
    expect(await balances()).toEqual({ available: 70_000, reserved: 30_000 });
    expect((await Withdrawal.findById(receipt.withdrawal.id).lean())!.status).toBe("PENDING");
  });
});

describe("window scope guard — withdrawals touch no betting or settlement state", () => {
  it("a full withdrawal exercise writes no bet / revision, no WIN_CREDIT, no round change", async () => {
    await fund(2_00_000);
    const a = await request(upiBody({ amountPaise: 30_000 }));
    const b = await request(bankBody({ amountPaise: 20_000 }));
    await cancelWithdrawal({ userId, withdrawalId: a.withdrawal.id });
    await approveWithdrawalByAdmin({ withdrawalId: new Types.ObjectId(b.withdrawal.id), adminId: new Types.ObjectId() });

    expect(await Bet.countDocuments()).toBe(0);
    expect(await BetRevision.countDocuments()).toBe(0);
    expect(await MarketRound.countDocuments()).toBe(0);
    expect(await WalletTransaction.countDocuments({ type: "WIN_CREDIT" })).toBe(0);
    expect(await WalletTransaction.countDocuments({ type: { $in: ["BET_PLACED", "BET_EDIT_DEBIT", "BET_EDIT_REFUND"] } })).toBe(0);
  });
});
