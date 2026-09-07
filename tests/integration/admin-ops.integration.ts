import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "@/lib/db/connection";
import { ensureIndexes } from "@/lib/db/models";
import { seedFoundation } from "@/modules/settings/services/seed-foundation";
import { hashPassword } from "@/lib/auth/password";
import { User } from "@/modules/users/models/user.model";
import { Session } from "@/modules/auth/models/session.model";
import { OtpRequest } from "@/modules/auth/models/otp-request.model";
import { Market } from "@/modules/markets/models/market.model";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { BetRevision } from "@/modules/betting/models/bet-revision.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { Withdrawal } from "@/modules/withdrawals/models/withdrawal.model";
import { AuditLog } from "@/modules/audit/models/audit-log.model";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import { mockDeposit } from "@/modules/wallet/services/mock-deposit.service";
import { createWithdrawalSchema } from "@/modules/withdrawals/validators/withdrawal-input";
import {
  cancelWithdrawal,
  requestWithdrawal,
} from "@/modules/withdrawals/services/withdrawal.service";
import { placeBetRequestSchema } from "@/modules/betting/validators/place-bet-input";
import { placeBet } from "@/modules/betting/services/bet-placement.service";
import { editBetRequestSchema } from "@/modules/betting/validators/edit-bet-input";
import { editBet } from "@/modules/betting/services/bet-edit.service";
import { getMarketBySlug, ensureMarketRound } from "@/modules/markets/services/market.service";
import * as adminWithdrawalService from "@/modules/admin/services/admin-withdrawal.service";
import {
  approveWithdrawalOp,
  getWithdrawalDetailForAdmin,
  listWithdrawalsForAdmin,
  rejectWithdrawalOp,
} from "@/modules/admin/services/admin-withdrawal.service";
import * as adminMarketService from "@/modules/admin/services/admin-market.service";
import {
  getMarketForAdmin,
  setMarketEnabled,
  updateMarketSchedule,
} from "@/modules/admin/services/admin-market.service";
import {
  confirmResultDeclaration,
  prepareResultDeclaration,
} from "@/modules/admin/services/admin-result.service";
import { getPayoutRate, updatePayoutRate } from "@/modules/admin/services/admin-settings.service";
import { listAuditLogs } from "@/modules/admin/services/admin-audit.service";
import { getAdminDashboard } from "@/modules/admin/services/admin-dashboard.service";
import * as adminBetService from "@/modules/admin/services/admin-bet.service";
import { getBetDetailForAdmin, listBetsForAdmin } from "@/modules/admin/services/admin-bet.service";

let replica: MongoMemoryReplSet | undefined;

const ist = (value: string) => new Date(`${value}+05:30`);
/** Faridabad 2026-09-06: opens 07:00, edit cutoff 16:50, closes 17:50 (IST). */
const OPEN = ist("2026-09-06T12:00:00");
const AT_CLOSE = ist("2026-09-06T17:50:00");
const AFTER_CLOSE = ist("2026-09-06T18:30:00");
const clockOf = (when: Date) => () => when;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_admin_ops"));
  vi.stubEnv("SESSION_SECRET", "test-only-secret-with-at-least-32-characters");
  await connectDatabase();
  await ensureIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
  vi.unstubAllEnvs();
});

let counter = 0;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Session.deleteMany({}),
    OtpRequest.deleteMany({}),
    Market.deleteMany({}),
    MarketRound.deleteMany({}),
    Bet.deleteMany({}),
    BetRevision.deleteMany({}),
    Wallet.deleteMany({}),
    WalletTransaction.deleteMany({}),
    Withdrawal.deleteMany({}),
    AuditLog.deleteMany({}),
    PlatformSettings.deleteMany({}),
  ]);
  await seedFoundation();
  counter = 0;
});

async function makeAdmin(): Promise<Types.ObjectId> {
  counter += 1;
  const admin = await User.create({
    role: "ADMIN",
    loginId: `admin-${Date.now()}-${counter}`,
    name: `Admin ${counter}`,
    passwordHash: await hashPassword("admin-fixture-password"),
    status: "ACTIVE",
  });
  return admin._id;
}

async function makePlayer(status: "ACTIVE" | "DISABLED" = "ACTIVE"): Promise<Types.ObjectId> {
  counter += 1;
  const user = await User.create({
    role: "PLAYER",
    loginId: `player-${Date.now()}-${counter}`,
    name: `Player ${counter}`,
    passwordHash: "test-fixture",
    status,
  });
  return user._id;
}

const fund = (userId: Types.ObjectId, amountPaise: number) =>
  mockDeposit({ userId, amountPaise, clientRequestId: randomUUID() });

async function walletOf(userId: Types.ObjectId) {
  const w = await Wallet.findOne({ userId }).lean();
  return { available: w!.availableBalancePaise, reserved: w!.reservedBalancePaise };
}

function bankRequest(over: Record<string, unknown> = {}) {
  return createWithdrawalSchema.parse({
    method: "BANK",
    amountPaise: 30_000,
    clientRequestId: randomUUID(),
    bank: {
      accountHolderName: "Ravi Kumar",
      accountNumber: "123456789012",
      confirmAccountNumber: "123456789012",
      ifsc: "HDFC0001234",
      bankName: "HDFC Bank",
    },
    ...over,
  });
}

async function makePendingWithdrawal(amountPaise = 30_000, opening = 100_000) {
  const userId = await makePlayer();
  await fund(userId, opening);
  const receipt = await requestWithdrawal({
    userId,
    request: bankRequest({ amountPaise }),
  });
  return { userId, withdrawalId: receipt.withdrawal.id };
}

function jodiRequest(over: Record<string, unknown> = {}) {
  return placeBetRequestSchema.parse({
    marketSlug: "faridabad",
    entryMethod: "JODI",
    numbers: ["07", "22", "48"],
    stakePaise: 1000,
    clientRequestId: randomUUID(),
    ...over,
  });
}

const placeJodi = (userId: Types.ObjectId, over: Record<string, unknown> = {}) =>
  placeBet({ userId, request: jodiRequest(over) }, { clock: clockOf(OPEN) });

// ============================================================================
describe("admin withdrawals — list & sensitive detail", () => {
  it("lists newest-requested-first with a player summary and a MASKED destination only", async () => {
    const a = await makePendingWithdrawal(10_000);
    const b = await makePendingWithdrawal(20_000);

    const { withdrawals } = await listWithdrawalsForAdmin({});
    expect(withdrawals).toHaveLength(2);
    expect(withdrawals[0].id).toBe(b.withdrawalId);
    expect(withdrawals[1].id).toBe(a.withdrawalId);
    expect(withdrawals[0].player).toMatchObject({ id: b.userId.toString() });
    expect(withdrawals[0].destinationSummary).toMatch(/••••9012$/);
    // No raw payout instrument anywhere in a list payload.
    expect(JSON.stringify(withdrawals)).not.toContain("123456789012");
    expect(withdrawals[0]).not.toHaveProperty("payoutDestination");
    expect(withdrawals[0]).not.toHaveProperty("paymentDetails");
  });

  it("filters by status / method / player search and paginates with a stable cursor", async () => {
    await makePendingWithdrawal(10_000);
    const target = await makePendingWithdrawal(20_000);
    const targetLogin = (await User.findById(target.userId))!.loginId;

    expect((await listWithdrawalsForAdmin({ status: "PENDING" })).withdrawals).toHaveLength(2);
    expect((await listWithdrawalsForAdmin({ status: "APPROVED" })).withdrawals).toHaveLength(0);
    expect((await listWithdrawalsForAdmin({ method: "UPI" })).withdrawals).toHaveLength(0);

    const bySearch = await listWithdrawalsForAdmin({ search: targetLogin });
    expect(bySearch.withdrawals).toHaveLength(1);
    expect(bySearch.withdrawals[0].id).toBe(target.withdrawalId);

    const firstPage = await listWithdrawalsForAdmin({ limit: 1 });
    expect(firstPage.withdrawals).toHaveLength(1);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await listWithdrawalsForAdmin({ limit: 1, cursor: firstPage.nextCursor! });
    expect(secondPage.withdrawals).toHaveLength(1);
    expect(secondPage.withdrawals[0].id).not.toBe(firstPage.withdrawals[0].id);
  });

  it("detail — and ONLY detail — returns the raw BANK payout destination + wallet view", async () => {
    const { withdrawalId } = await makePendingWithdrawal();
    const detail = await getWithdrawalDetailForAdmin(withdrawalId);
    expect(detail.payoutDestination).toEqual({
      method: "BANK",
      accountHolderName: "Ravi Kumar",
      accountNumber: "123456789012",
      ifsc: "HDFC0001234",
      bankName: "HDFC Bank",
    });
    expect(detail.wallet).toMatchObject({ availableBalancePaise: 70_000, reservedBalancePaise: 30_000 });
    await expect(getWithdrawalDetailForAdmin("deadbeef")).rejects.toMatchObject({ code: "WITHDRAWAL_NOT_FOUND" });
  });
});

// ============================================================================
describe("admin withdrawals — Mark Paid & Approve", () => {
  it("finalizes RESERVED only — available is NEVER debited a second time", async () => {
    const adminId = await makeAdmin();
    const { userId, withdrawalId } = await makePendingWithdrawal(30_000, 100_000);
    expect(await walletOf(userId)).toEqual({ available: 70_000, reserved: 30_000 });

    const result = await approveWithdrawalOp({
      actorAdminId: adminId,
      withdrawalId,
      clientRequestId: randomUUID(),
      paymentReference: "UTR-77123",
      note: "paid by IMPS",
    });
    expect(result.withdrawal.status).toBe("APPROVED");
    expect(result.idempotentReplay).toBe(false);

    // THE PROOF: available unchanged at 70_000, reserved drained to 0, total down by exactly 30_000.
    expect(await walletOf(userId)).toEqual({ available: 70_000, reserved: 0 });

    const ledger = await WalletTransaction.find({ referenceId: new Types.ObjectId(withdrawalId) }).lean();
    const approvedRows = ledger.filter((r) => r.type === "WITHDRAWAL_APPROVED");
    expect(approvedRows).toHaveLength(1);
    expect(approvedRows[0].availableDeltaPaise).toBe(0);
    expect(approvedRows[0].reservedDeltaPaise).toBe(-30_000);

    const audits = await AuditLog.find({ action: "WITHDRAWAL_APPROVED", entityId: new Types.ObjectId(withdrawalId) }).lean();
    expect(audits).toHaveLength(1);
    expect(audits[0].actorAdminId.toString()).toBe(adminId.toString());
    expect(JSON.stringify(audits[0])).not.toContain("123456789012");

    const stored = await Withdrawal.findById(withdrawalId).lean();
    expect(stored!.decidedByAdminId!.toString()).toBe(adminId.toString());
    expect(stored!.paymentReference).toBe("UTR-77123");
    expect(stored!.decisionNote).toBe("paid by IMPS");
  });

  it("is retry-safe: an exact replay of the same request id returns the original with no second movement", async () => {
    const adminId = await makeAdmin();
    const { userId, withdrawalId } = await makePendingWithdrawal();
    const requestId = randomUUID();
    const first = await approveWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: requestId, paymentReference: "R1" });
    const replay = await approveWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: requestId, paymentReference: "R1" });

    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(await walletOf(userId)).toEqual({ available: 70_000, reserved: 0 });
    expect(await WalletTransaction.countDocuments({ referenceId: new Types.ObjectId(withdrawalId), type: "WITHDRAWAL_APPROVED" })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "WITHDRAWAL_APPROVED", entityId: new Types.ObjectId(withdrawalId) })).toBe(1);
  });

  it("conflicts: same request id + different reference, or reused for another withdrawal → DUPLICATE_REQUEST", async () => {
    const adminId = await makeAdmin();
    const one = await makePendingWithdrawal();
    const two = await makePendingWithdrawal();
    const requestId = randomUUID();
    await approveWithdrawalOp({ actorAdminId: adminId, withdrawalId: one.withdrawalId, clientRequestId: requestId, paymentReference: "REF-A" });

    await expect(
      approveWithdrawalOp({ actorAdminId: adminId, withdrawalId: one.withdrawalId, clientRequestId: requestId, paymentReference: "REF-B" }),
    ).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
    await expect(
      approveWithdrawalOp({ actorAdminId: adminId, withdrawalId: two.withdrawalId, clientRequestId: requestId, paymentReference: "REF-A" }),
    ).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
  });

  it("a non-PENDING withdrawal is WITHDRAWAL_NOT_PENDING", async () => {
    const adminId = await makeAdmin();
    const { userId, withdrawalId } = await makePendingWithdrawal();
    await cancelWithdrawal({ userId, withdrawalId });
    await expect(
      approveWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "WITHDRAWAL_NOT_PENDING" });
  });
});

// ============================================================================
describe("admin withdrawals — reject", () => {
  it("releases RESERVED back to available, stores the reason, writes one ledger + one audit", async () => {
    const adminId = await makeAdmin();
    const { userId, withdrawalId } = await makePendingWithdrawal(20_000, 50_000);
    expect(await walletOf(userId)).toEqual({ available: 30_000, reserved: 20_000 });

    const result = await rejectWithdrawalOp({
      actorAdminId: adminId,
      withdrawalId,
      clientRequestId: randomUUID(),
      reason: "Payout account name mismatch",
    });
    expect(result.withdrawal.status).toBe("REJECTED");
    expect(result.withdrawal.rejectionReason).toBe("Payout account name mismatch");
    expect(await walletOf(userId)).toEqual({ available: 50_000, reserved: 0 });

    expect(await WalletTransaction.countDocuments({ referenceId: new Types.ObjectId(withdrawalId), type: "WITHDRAWAL_RELEASED" })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "WITHDRAWAL_REJECTED", entityId: new Types.ObjectId(withdrawalId) })).toBe(1);
  });

  it("requires a non-empty reason", async () => {
    const adminId = await makeAdmin();
    const { withdrawalId } = await makePendingWithdrawal();
    await expect(
      rejectWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: randomUUID(), reason: "   " }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("approve then reject under the SAME request id → DUPLICATE_REQUEST", async () => {
    const adminId = await makeAdmin();
    const { withdrawalId } = await makePendingWithdrawal();
    const requestId = randomUUID();
    await approveWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: requestId });
    await expect(
      rejectWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: requestId, reason: "changed mind" }),
    ).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
  });
});

// ============================================================================
describe("admin withdrawals — concurrency", () => {
  it("approve || approve (distinct request ids) → one transition, one ledger, one audit, available unchanged", async () => {
    const adminId = await makeAdmin();
    const { userId, withdrawalId } = await makePendingWithdrawal(30_000, 100_000);

    const results = await Promise.allSettled([
      approveWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: randomUUID() }),
      approveWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await walletOf(userId)).toEqual({ available: 70_000, reserved: 0 });
    expect(await WalletTransaction.countDocuments({ referenceId: new Types.ObjectId(withdrawalId), type: "WITHDRAWAL_APPROVED" })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "WITHDRAWAL_APPROVED", entityId: new Types.ObjectId(withdrawalId) })).toBe(1);
    expect((await Withdrawal.findById(withdrawalId))!.status).toBe("APPROVED");
  });

  it("reject || reject → release exactly once, one terminal REJECTED, one ledger, one audit", async () => {
    const adminId = await makeAdmin();
    const { userId, withdrawalId } = await makePendingWithdrawal(20_000, 60_000);

    await Promise.allSettled([
      rejectWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: randomUUID(), reason: "a" }),
      rejectWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: randomUUID(), reason: "b" }),
    ]);
    expect(await walletOf(userId)).toEqual({ available: 60_000, reserved: 0 });
    expect(await WalletTransaction.countDocuments({ referenceId: new Types.ObjectId(withdrawalId), type: "WITHDRAWAL_RELEASED" })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "WITHDRAWAL_REJECTED", entityId: new Types.ObjectId(withdrawalId) })).toBe(1);
    expect((await Withdrawal.findById(withdrawalId))!.status).toBe("REJECTED");
  });

  it("approve || reject → exactly one wins, wallet matches the winner, never both", async () => {
    const adminId = await makeAdmin();
    const { userId, withdrawalId } = await makePendingWithdrawal(30_000, 100_000);

    await Promise.allSettled([
      approveWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: randomUUID() }),
      rejectWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: randomUUID(), reason: "race" }),
    ]);

    const final = await Withdrawal.findById(withdrawalId).lean();
    const wallet = await walletOf(userId);
    expect(["APPROVED", "REJECTED"]).toContain(final!.status);
    if (final!.status === "APPROVED") {
      expect(wallet).toEqual({ available: 70_000, reserved: 0 });
    } else {
      expect(wallet).toEqual({ available: 100_000, reserved: 0 });
    }
    const approvedLedger = await WalletTransaction.countDocuments({ referenceId: new Types.ObjectId(withdrawalId), type: "WITHDRAWAL_APPROVED" });
    const releasedLedger = await WalletTransaction.countDocuments({ referenceId: new Types.ObjectId(withdrawalId), type: "WITHDRAWAL_RELEASED" });
    expect(approvedLedger + releasedLedger).toBe(1);
    expect(wallet.reserved).toBeGreaterThanOrEqual(0);
  });

  it("player cancel || admin approve → exactly one terminal transition, wallet conserved", async () => {
    const adminId = await makeAdmin();
    const { userId, withdrawalId } = await makePendingWithdrawal(25_000, 80_000);

    await Promise.allSettled([
      cancelWithdrawal({ userId, withdrawalId }),
      approveWithdrawalOp({ actorAdminId: adminId, withdrawalId, clientRequestId: randomUUID() }),
    ]);

    const final = await Withdrawal.findById(withdrawalId).lean();
    const wallet = await walletOf(userId);
    expect(["CANCELLED", "APPROVED"]).toContain(final!.status);
    expect(wallet.reserved).toBe(0);
    expect(wallet.available).toBe(final!.status === "CANCELLED" ? 80_000 : 55_000);
    const moves = await WalletTransaction.countDocuments({
      referenceId: new Types.ObjectId(withdrawalId),
      type: { $in: ["WITHDRAWAL_RELEASED", "WITHDRAWAL_APPROVED"] },
    });
    expect(moves).toBe(1);
  });
});

// ============================================================================
describe("admin markets — enable / disable / schedule", () => {
  it("disable is server-authoritative (blocks new bets) + audited + idempotent; re-enable restores lifecycle", async () => {
    const adminId = await makeAdmin();
    const market = await getMarketBySlug("faridabad");
    const player = await makePlayer();
    await fund(player, 100_000);

    await setMarketEnabled({ actorAdminId: adminId, marketId: market._id.toHexString(), enabled: false });
    expect((await Market.findById(market._id))!.enabled).toBe(false);
    await expect(placeJodi(player)).rejects.toMatchObject({ code: "MARKET_DISABLED" });
    expect(await AuditLog.countDocuments({ action: "MARKET_DISABLED", entityId: market._id })).toBe(1);

    // idempotent repeat — no second audit row
    await setMarketEnabled({ actorAdminId: adminId, marketId: market._id.toHexString(), enabled: false });
    expect(await AuditLog.countDocuments({ action: "MARKET_DISABLED", entityId: market._id })).toBe(1);

    await setMarketEnabled({ actorAdminId: adminId, marketId: market._id.toHexString(), enabled: true });
    expect((await Market.findById(market._id))!.enabled).toBe(true);
    expect(await AuditLog.countDocuments({ action: "MARKET_ENABLED", entityId: market._id })).toBe(1);
    await expect(placeJodi(player)).resolves.toBeTruthy();
  });

  it("schedule validation: impossible ordering and an over-long edit lock are rejected", async () => {
    const adminId = await makeAdmin();
    const market = await getMarketBySlug("faridabad");
    await expect(
      updateMarketSchedule({ actorAdminId: adminId, marketId: market._id.toHexString(), openTime: "18:00", closeTime: "09:00", closeDayOffset: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      updateMarketSchedule({ actorAdminId: adminId, marketId: market._id.toHexString(), editLockMinutesBeforeClose: 5000 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("Disawar cross-midnight schedule (closeDayOffset 1) is accepted and persisted", async () => {
    const adminId = await makeAdmin();
    const disawar = await getMarketBySlug("disawar");
    const dto = await updateMarketSchedule({
      actorAdminId: adminId,
      marketId: disawar._id.toHexString(),
      closeTime: "03:30",
      closeDayOffset: 1,
    });
    expect(dto.schedule).toMatchObject({ closeTime: "03:30", closeDayOffset: 1 });
    const stored = await Market.findById(disawar._id).lean();
    expect(stored!.closeTimeMinutes).toBe(210);
    expect(stored!.closeDayOffset).toBe(1);
    expect(await AuditLog.countDocuments({ action: "MARKET_SCHEDULE_UPDATED", entityId: disawar._id })).toBe(1);
  });

  it("a schedule change NEVER rewrites an existing MarketRound snapshot; a future round uses the new schedule", async () => {
    const adminId = await makeAdmin();
    const market = await getMarketBySlug("faridabad");
    const existing = await ensureMarketRound(market, "2026-09-06");
    const frozen = {
      opensAt: existing.opensAt.toISOString(),
      editCutoffAt: existing.editCutoffAt.toISOString(),
      closesAt: existing.closesAt.toISOString(),
    };

    await updateMarketSchedule({ actorAdminId: adminId, marketId: market._id.toHexString(), closeTime: "18:30" });

    const sameRound = await MarketRound.findById(existing._id).lean();
    expect({
      opensAt: sameRound!.opensAt.toISOString(),
      editCutoffAt: sameRound!.editCutoffAt.toISOString(),
      closesAt: sameRound!.closesAt.toISOString(),
    }).toEqual(frozen);

    const freshMarket = await Market.findById(market._id);
    const futureRound = await ensureMarketRound(freshMarket!, "2026-09-20");
    expect(futureRound.closesAt.toISOString()).toBe(ist("2026-09-20T18:30:00").toISOString());
  });

  it("admin market list/detail expose config + current round + serverNow, by id", async () => {
    await makeAdmin();
    const market = await getMarketBySlug("faridabad");
    const detail = await getMarketForAdmin(market._id.toHexString(), OPEN);
    expect(detail).toMatchObject({ slug: "faridabad", enabled: true });
    expect(detail.schedule).toMatchObject({ openTime: "07:00", closeTime: "17:50", editLockMinutesBeforeClose: 60 });
    expect(detail.currentRound).not.toBeNull();
    await expect(getMarketForAdmin("nope")).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
  });
});

// ============================================================================
describe("admin result declaration — two-step, NO settlement", () => {
  it("preview does not mutate; before close is RESULT_TOO_EARLY; exactly at close is allowed", async () => {
    const market = await getMarketBySlug("faridabad");
    const marketId = market._id.toHexString();

    await expect(
      prepareResultDeclaration({ marketId, result: "07" }, OPEN),
    ).rejects.toMatchObject({ code: "RESULT_TOO_EARLY" });

    const preview = await prepareResultDeclaration({ marketId, result: "07" }, AT_CLOSE);
    expect(preview).toMatchObject({ proposedResult: "07", currentResult: null, alreadyDeclared: false, settlementPerformed: false });
    expect(preview.warning).toMatch(/does NOT settle/i);

    const round = await MarketRound.findOne({ marketId: market._id }).lean();
    expect(round!.result ?? null).toBeNull();
    expect(await AuditLog.countDocuments({ action: "RESULT_DECLARED" })).toBe(0);
  });

  it('declares "00" / "07" / "99" as-is (string, leading zero preserved) with one audit row and NO settlement', async () => {
    for (const value of ["00", "07", "99"]) {
      await Market.deleteMany({});
      await MarketRound.deleteMany({});
      await AuditLog.deleteMany({});
      await Bet.deleteMany({});
      await Wallet.deleteMany({});
      await WalletTransaction.deleteMany({});
      await seedFoundation();

      const adminId = await makeAdmin();
      const player = await makePlayer();
      await fund(player, 100_000);
      const bet = await placeJodi(player);
      const walletBefore = await walletOf(player);

      const market = await getMarketBySlug("faridabad");
      const declared = await confirmResultDeclaration(
        { actorAdminId: adminId, marketId: market._id.toHexString(), result: value, clientRequestId: randomUUID() },
        AFTER_CLOSE,
      );
      expect(declared.result).toBe(value);
      expect(typeof declared.result).toBe("string");
      expect(declared.settlementPerformed).toBe(false);

      const round = await MarketRound.findOne({ marketId: market._id }).lean();
      expect(round!.result).toBe(value);
      expect(round!.settlementStatus).toBe("PENDING");
      expect(await AuditLog.countDocuments({ action: "RESULT_DECLARED" })).toBe(1);

      // NO settlement side effects.
      const betAfter = await Bet.findById(bet.bet.id).lean();
      expect(betAfter!.status).toBe("ACTIVE");
      expect(betAfter!.winningNumber ?? null).toBeNull();
      expect(betAfter!.payoutPaise ?? null).toBeNull();
      expect(await walletOf(player)).toEqual(walletBefore);
      expect(await WalletTransaction.countDocuments({ type: "WIN_CREDIT" })).toBe(0);
    }
  });

  it("duplicate exact confirm is a safe replay; a conflicting result under the same id is DUPLICATE_REQUEST", async () => {
    const adminId = await makeAdmin();
    const market = await getMarketBySlug("faridabad");
    const marketId = market._id.toHexString();
    const requestId = randomUUID();

    const first = await confirmResultDeclaration({ actorAdminId: adminId, marketId, result: "42", clientRequestId: requestId }, AFTER_CLOSE);
    const replay = await confirmResultDeclaration({ actorAdminId: adminId, marketId, result: "42", clientRequestId: requestId }, AFTER_CLOSE);
    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(await AuditLog.countDocuments({ action: "RESULT_DECLARED" })).toBe(1);

    await expect(
      confirmResultDeclaration({ actorAdminId: adminId, marketId, result: "43", clientRequestId: requestId }, AFTER_CLOSE),
    ).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
  });

  it("a round that already has a result is RESULT_ALREADY_DECLARED (no unrestricted correction)", async () => {
    const adminId = await makeAdmin();
    const market = await getMarketBySlug("faridabad");
    const marketId = market._id.toHexString();
    await confirmResultDeclaration({ actorAdminId: adminId, marketId, result: "11", clientRequestId: randomUUID() }, AFTER_CLOSE);
    await expect(
      confirmResultDeclaration({ actorAdminId: adminId, marketId, result: "22", clientRequestId: randomUUID() }, AFTER_CLOSE),
    ).rejects.toMatchObject({ code: "RESULT_ALREADY_DECLARED" });
  });

  it("two admins declaring concurrently → exactly one wins, one result, one audit", async () => {
    const a1 = await makeAdmin();
    const a2 = await makeAdmin();
    const market = await getMarketBySlug("faridabad");
    const marketId = market._id.toHexString();

    const settled = await Promise.allSettled([
      confirmResultDeclaration({ actorAdminId: a1, marketId, result: "31", clientRequestId: randomUUID() }, AFTER_CLOSE),
      confirmResultDeclaration({ actorAdminId: a2, marketId, result: "77", clientRequestId: randomUUID() }, AFTER_CLOSE),
    ]);
    const ok = settled.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(await AuditLog.countDocuments({ action: "RESULT_DECLARED" })).toBe(1);
    const round = await MarketRound.findOne({ marketId: market._id }).lean();
    expect(["31", "77"]).toContain(round!.result);
  });
});

// ============================================================================
describe("admin payout rate — future-only", () => {
  it("read is 90; a valid update audits before/after; Bet A keeps its old snapshot, Bet B gets the new one", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    await fund(player, 100_000);

    expect((await getPayoutRate()).payoutMultiplier).toBe(90);
    const betA = await placeJodi(player);
    expect(betA.bet.payoutMultiplierSnapshot).toBe(90);

    const updated = await updatePayoutRate({ actorAdminId: adminId, payoutMultiplier: 95 });
    expect(updated).toMatchObject({ payoutMultiplier: 95, previousPayoutMultiplier: 90, changed: true });
    const audit = await AuditLog.findOne({ action: "PAYOUT_RATE_UPDATED" }).lean();
    expect(audit!.before).toMatchObject({ payoutMultiplier: 90 });
    expect(audit!.after).toMatchObject({ payoutMultiplier: 95 });

    const betB = await placeJodi(player);
    expect(betB.bet.payoutMultiplierSnapshot).toBe(95);

    // Bet A's historical snapshot is untouched — no mass update.
    expect((await Bet.findById(betA.bet.id).lean())!.payoutMultiplierSnapshot).toBe(90);
    expect((await getPayoutRate()).payoutMultiplier).toBe(95);
    expect(await WalletTransaction.countDocuments({ type: "WIN_CREDIT" })).toBe(0);
  });

  it("rejects an invalid multiplier and no-ops an unchanged value (no second audit)", async () => {
    const adminId = await makeAdmin();
    await expect(updatePayoutRate({ actorAdminId: adminId, payoutMultiplier: 0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(updatePayoutRate({ actorAdminId: adminId, payoutMultiplier: 1.5 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const first = await updatePayoutRate({ actorAdminId: adminId, payoutMultiplier: 90 });
    expect(first.changed).toBe(false);
    expect(await AuditLog.countDocuments({ action: "PAYOUT_RATE_UPDATED" })).toBe(0);
  });
});

// ============================================================================
describe("admin audit browser", () => {
  it("filters by action / actor, paginates, and re-redacts secret-bearing snapshot keys on read", async () => {
    const adminId = await makeAdmin();
    const other = await makeAdmin();
    const market = await getMarketBySlug("faridabad");
    await setMarketEnabled({ actorAdminId: adminId, marketId: market._id.toHexString(), enabled: false });
    await setMarketEnabled({ actorAdminId: other, marketId: market._id.toHexString(), enabled: true });

    // A raw row inserted past the writer, carrying secret-looking keys.
    await AuditLog.collection.insertOne({
      actorAdminId: adminId,
      action: "MARKET_DISABLED",
      entityType: "Market",
      after: { password: "hunter2", sessionSecret: "abc", token: "t", ok: 1 },
      createdAt: new Date(),
    });

    const byAction = await listAuditLogs({ action: "MARKET_DISABLED" });
    expect(byAction.logs.length).toBeGreaterThanOrEqual(2);
    const leaked = JSON.stringify(byAction.logs);
    expect(leaked).not.toContain("hunter2");
    expect(leaked).not.toContain("abc");
    expect(leaked).toContain("[REDACTED]");

    const byActor = await listAuditLogs({ actorAdminId: other.toHexString() });
    expect(byActor.logs.every((l) => l.actorAdminId === other.toHexString())).toBe(true);

    const p1 = await listAuditLogs({ limit: 1 });
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await listAuditLogs({ limit: 1, cursor: p1.nextCursor! });
    expect(p2.logs[0].id).not.toBe(p1.logs[0].id);
  });
});

// ============================================================================
describe("admin dashboard", () => {
  it("returns real server-calculated aggregates, no fabricated values", async () => {
    await makeAdmin();
    const p1 = await makePlayer();
    const p2 = await makePlayer();
    await makePlayer("DISABLED");
    await fund(p1, 100_000);
    await fund(p2, 40_000);
    await placeJodi(p1); // stake 3000
    const w = await requestWithdrawal({ userId: p2, request: bankRequest({ amountPaise: 15_000 }) });
    expect(w.withdrawal.status).toBe("PENDING");

    const dash = await getAdminDashboard(OPEN);
    expect(dash.players).toMatchObject({ active: 2, disabled: 1, total: 3 });
    // p1: 100_000 - 3_000 = 97_000 available; p2: 40_000 - 15_000 = 25_000 available + 15_000 reserved
    expect(dash.wallet).toEqual({ totalAvailablePaise: 122_000, totalReservedPaise: 15_000 });
    expect(dash.withdrawals).toEqual({ pendingCount: 1, pendingAmountPaise: 15_000 });
    expect(dash.betsToday.count).toBe(1);
    expect(dash.betsToday.totalStakePaise).toBe(3_000);
    expect(dash.markets).toHaveLength(6);
    expect(typeof dash.serverNow).toBe("string");
  });
});

// ============================================================================
describe("admin global bet reads — READ ONLY", () => {
  it("lists with filters and returns detail + revision history; exposes no mutation API", async () => {
    await makeAdmin();
    const p1 = await makePlayer();
    const p2 = await makePlayer();
    await fund(p1, 100_000);
    await fund(p2, 100_000);
    const a = await placeJodi(p1);
    await placeJodi(p2);

    const all = await listBetsForAdmin({}, OPEN);
    expect(all.bets).toHaveLength(2);
    expect(all.bets[0].player).toHaveProperty("loginId");

    expect((await listBetsForAdmin({ playerId: p1.toHexString() }, OPEN)).bets).toHaveLength(1);
    expect((await listBetsForAdmin({ market: "faridabad" }, OPEN)).bets).toHaveLength(2);
    expect((await listBetsForAdmin({ entryMethod: "JODI" }, OPEN)).bets).toHaveLength(2);
    expect((await listBetsForAdmin({ entryMethod: "CROSSING" }, OPEN)).bets).toHaveLength(0);
    expect((await listBetsForAdmin({ businessDate: "2026-09-06" }, OPEN)).bets).toHaveLength(2);

    // create a revision, then read it through the admin detail
    await editBet(
      {
        userId: p1,
        betRef: a.bet.id,
        request: editBetRequestSchema.parse({
          entryMethod: "JODI",
          numbers: ["07", "22", "48", "51"],
          stakePaise: 1000,
          expectedVersion: 1,
          editRequestId: randomUUID(),
        }),
      },
      { clock: clockOf(OPEN) },
    );
    const detail = await getBetDetailForAdmin(a.bet.id, OPEN);
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0]).toMatchObject({ fromVersion: 1, toVersion: 2 });
    expect(detail.player.id).toBe(p1.toString());

    // No admin bet mutation surface anywhere.
    for (const name of ["updateBet", "deleteBet", "editBet", "mutateBet", "setBet"]) {
      expect(adminBetService).not.toHaveProperty(name);
    }
    await expect(getBetDetailForAdmin("deadbeef")).rejects.toMatchObject({ code: "BET_NOT_FOUND" });
  });
});

// ============================================================================
describe("module surface — no settlement, no bet mutation", () => {
  it("admin ops modules expose no settlement / WIN_CREDIT / bet-mutation entry points", () => {
    for (const name of ["settle", "settleRound", "creditWin", "runSettlement", "settleBet"]) {
      expect(adminWithdrawalService).not.toHaveProperty(name);
      expect(adminMarketService).not.toHaveProperty(name);
      expect(adminBetService).not.toHaveProperty(name);
    }
  });
});
