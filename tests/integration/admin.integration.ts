import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase, withTransaction } from "@/lib/db/connection";
import { ensureIndexes } from "@/lib/db/models";
import { seedFoundation } from "@/modules/settings/services/seed-foundation";
import { User } from "@/modules/users/models/user.model";
import { Session } from "@/modules/auth/models/session.model";
import { OtpRequest } from "@/modules/auth/models/otp-request.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { BetRevision } from "@/modules/betting/models/bet-revision.model";
import { Withdrawal } from "@/modules/withdrawals/models/withdrawal.model";
import { AuditLog } from "@/modules/audit/models/audit-log.model";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, findActiveSessionUser } from "@/modules/auth/services/session.service";
import { creditAvailableInSession, reserveInSession } from "@/modules/wallet/services/wallet.service";
import {
  createPlayer,
  disablePlayer,
  enablePlayer,
  getPlayerDetail,
  listPlayers,
  resetPlayerPassword,
} from "@/modules/admin/services/admin-player.service";
import {
  adminCreditWallet,
  adminDebitWallet,
  buildAdminAdjustmentKey,
  listPlayerWalletTransactionsForAdmin,
} from "@/modules/admin/services/admin-wallet.service";
import { playerDeletionService } from "@/modules/admin/services/player-deletion.service";

let replica: MongoMemoryReplSet | undefined;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_admin"));
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
    Session.deleteMany({}),
    OtpRequest.deleteMany({}),
    Wallet.deleteMany({}),
    WalletTransaction.deleteMany({}),
    Bet.deleteMany({}),
    BetRevision.deleteMany({}),
    Withdrawal.deleteMany({}),
    AuditLog.deleteMany({}),
    PlatformSettings.deleteMany({}),
  ]);
  await seedFoundation();
});

let adminCounter = 0;
async function makeAdmin(): Promise<Types.ObjectId> {
  adminCounter += 1;
  const admin = await User.create({
    role: "ADMIN",
    loginId: `admin-${adminCounter}`,
    name: `Admin ${adminCounter}`,
    passwordHash: await hashPassword("admin-fixture-password"),
    status: "ACTIVE",
  });
  return admin._id;
}

/** Fixture-only direct balance seed for isolated concurrency/primitive tests. */
async function seedWalletBalance(
  userId: Types.ObjectId,
  balances: { available?: number; reserved?: number },
): Promise<void> {
  await Wallet.findOneAndUpdate(
    { userId },
    { $set: { availableBalancePaise: balances.available ?? 0, reservedBalancePaise: balances.reserved ?? 0 } },
    { upsert: true },
  );
}

const uuid = () => randomUUID();

// --------------------------------------------------------------------------------------------
describe("createPlayer", () => {
  it("creates a PLAYER + a ₹0 wallet + a PLAYER_CREATED audit atomically, normalizing the loginId", async () => {
    const adminId = await makeAdmin();
    const detail = await createPlayer({
      actorAdminId: adminId,
      loginId: "New_Player",
      name: "New Player",
      password: "player-demo-secret",
      phone: "9990001111",
    });

    expect(detail.loginId).toBe("new_player");
    expect(detail.status).toBe("ACTIVE");
    expect(detail.wallet).toMatchObject({ availableBalancePaise: 0, reservedBalancePaise: 0, totalBalancePaise: 0 });

    const stored = await User.findOne({ loginId: "new_player" }).select("+passwordHash");
    expect(stored?.role).toBe("PLAYER");
    expect(stored?.createdBy?.toString()).toBe(adminId.toString());
    expect(await verifyPassword("player-demo-secret", stored!.passwordHash)).toBe(true);
    expect(await Wallet.countDocuments({ userId: stored!._id })).toBe(1);

    const audit = await AuditLog.findOne({ action: "PLAYER_CREATED", subjectUserId: stored!._id }).lean();
    expect(audit?.actorAdminId.toString()).toBe(adminId.toString());
    expect(JSON.stringify(audit)).not.toContain("passwordHash");
    expect(JSON.stringify(audit)).not.toContain("player-demo-secret");
  });

  it("rejects a duplicate loginId with LOGIN_ID_TAKEN and writes no second user / wallet / audit", async () => {
    const adminId = await makeAdmin();
    await createPlayer({ actorAdminId: adminId, loginId: "dupe", name: "First", password: "aaaaaaaa" });
    await expect(
      createPlayer({ actorAdminId: adminId, loginId: "DUPE", name: "Second", password: "bbbbbbbb" }),
    ).rejects.toMatchObject({ code: "LOGIN_ID_TAKEN" });

    expect(await User.countDocuments({ loginId: "dupe" })).toBe(1);
    expect(await User.countDocuments({ role: "PLAYER" })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "PLAYER_CREATED" })).toBe(1);
  });

  it("rejects a duplicate phone with IDENTIFIER_TAKEN", async () => {
    const adminId = await makeAdmin();
    await createPlayer({ actorAdminId: adminId, loginId: "p-a", name: "A", password: "aaaaaaaa", phone: "9111111111" });
    await expect(
      createPlayer({ actorAdminId: adminId, loginId: "p-b", name: "B", password: "bbbbbbbb", phone: "9111111111" }),
    ).rejects.toMatchObject({ code: "IDENTIFIER_TAKEN" });
  });
});

// --------------------------------------------------------------------------------------------
describe("listPlayers", () => {
  it("returns PLAYERs only, newest first, with joined wallet balances + bet/withdrawal counts", async () => {
    const adminId = await makeAdmin();
    const a = await createPlayer({ actorAdminId: adminId, loginId: "list-a", name: "A", password: "aaaaaaaa" });
    const b = await createPlayer({ actorAdminId: adminId, loginId: "list-b", name: "B", password: "bbbbbbbb" });
    await adminCreditWallet({
      actorAdminId: adminId, playerId: b.id, amountPaise: 250000, reason: "seed", clientRequestId: uuid(),
    });

    const page = await listPlayers({});
    expect(page.players.map((p) => p.loginId)).toEqual(["list-b", "list-a"]); // newest first
    expect(page.players.every((p) => p.status === "ACTIVE")).toBe(true);
    const bRow = page.players.find((p) => p.id === b.id)!;
    expect(bRow.availableBalancePaise).toBe(250000);
    expect(bRow.totalBalancePaise).toBe(250000);
    const aRow = page.players.find((p) => p.id === a.id)!;
    expect(aRow.availableBalancePaise).toBe(0);
    expect(aRow.betCount).toBe(0);
    expect(aRow.withdrawalCount).toBe(0);
    // the fixture admins are never listed
    expect(page.players.some((p) => p.loginId.startsWith("admin-"))).toBe(false);
  });

  it("paginates with a stable cursor (no gaps, no overlap) and filters by status + search", async () => {
    const adminId = await makeAdmin();
    for (let i = 0; i < 5; i += 1) {
      await createPlayer({ actorAdminId: adminId, loginId: `pg-${i}`, name: `P${i}`, password: "pppppppp", phone: `98700000${i}` });
    }
    const first = await listPlayers({ limit: 2 });
    expect(first.players).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listPlayers({ limit: 2, cursor: first.nextCursor! });
    const third = await listPlayers({ limit: 2, cursor: second.nextCursor! });
    const seen = new Set([...first.players, ...second.players, ...third.players].map((p) => p.id));
    expect(seen.size).toBe(5);
    expect(third.nextCursor).toBeNull();

    await disablePlayer({ actorAdminId: adminId, playerId: first.players[0].id });
    expect((await listPlayers({ status: "DISABLED" })).players.map((p) => p.id)).toEqual([first.players[0].id]);
    expect((await listPlayers({ search: "pg-3" })).players.map((p) => p.loginId)).toEqual(["pg-3"]);
    expect((await listPlayers({ search: "987000004" })).players.map((p) => p.loginId)).toEqual(["pg-4"]);
  });
});

// --------------------------------------------------------------------------------------------
describe("getPlayerDetail", () => {
  it("returns sanitized identity + wallet totals, and is PLAYER_NOT_FOUND for an ADMIN or malformed id", async () => {
    const adminId = await makeAdmin();
    const created = await createPlayer({ actorAdminId: adminId, loginId: "detail-1", name: "D", password: "dddddddd" });
    const detail = await getPlayerDetail(created.id);
    expect(detail).toMatchObject({ loginId: "detail-1", status: "ACTIVE" });
    expect(detail.wallet.totalBalancePaise).toBe(
      detail.wallet.availableBalancePaise + detail.wallet.reservedBalancePaise,
    );
    expect(JSON.stringify(detail)).not.toContain("passwordHash");

    await expect(getPlayerDetail(adminId.toHexString())).rejects.toMatchObject({ code: "PLAYER_NOT_FOUND" });
    await expect(getPlayerDetail("not-a-hex-id")).rejects.toMatchObject({ code: "PLAYER_NOT_FOUND" });
  });
});

// --------------------------------------------------------------------------------------------
describe("disable / enable", () => {
  it("disable flips status, revokes every session in-txn, audits once, and is idempotent", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "dis-1", name: "D", password: "dddddddd" });
    const playerObjId = new Types.ObjectId(player.id);
    const { rawToken } = await createSession(playerObjId);
    expect(await findActiveSessionUser(rawToken)).not.toBeNull();

    const after = await disablePlayer({ actorAdminId: adminId, playerId: player.id });
    expect(after.status).toBe("DISABLED");
    expect(await Session.countDocuments({ userId: playerObjId })).toBe(0);
    expect(await findActiveSessionUser(rawToken)).toBeNull();
    expect(await AuditLog.countDocuments({ action: "PLAYER_DISABLED", subjectUserId: playerObjId })).toBe(1);

    await disablePlayer({ actorAdminId: adminId, playerId: player.id });
    expect(await AuditLog.countDocuments({ action: "PLAYER_DISABLED", subjectUserId: playerObjId })).toBe(1);
  });

  it("enable flips DISABLED→ACTIVE, does not recreate sessions, audits once, and is idempotent", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "en-1", name: "E", password: "eeeeeeee" });
    const playerObjId = new Types.ObjectId(player.id);
    await disablePlayer({ actorAdminId: adminId, playerId: player.id });

    const after = await enablePlayer({ actorAdminId: adminId, playerId: player.id });
    expect(after.status).toBe("ACTIVE");
    expect(await Session.countDocuments({ userId: playerObjId })).toBe(0);
    expect(await AuditLog.countDocuments({ action: "PLAYER_ENABLED", subjectUserId: playerObjId })).toBe(1);

    await enablePlayer({ actorAdminId: adminId, playerId: player.id });
    expect(await AuditLog.countDocuments({ action: "PLAYER_ENABLED", subjectUserId: playerObjId })).toBe(1);
  });

  it("cannot disable an ADMIN target (PLAYER_NOT_FOUND) and the admin stays ACTIVE", async () => {
    const adminId = await makeAdmin();
    const otherAdmin = await makeAdmin();
    await expect(
      disablePlayer({ actorAdminId: adminId, playerId: otherAdmin.toHexString() }),
    ).rejects.toMatchObject({ code: "PLAYER_NOT_FOUND" });
    expect((await User.findById(otherAdmin))?.status).toBe("ACTIVE");
  });
});

// --------------------------------------------------------------------------------------------
describe("resetPlayerPassword", () => {
  it("hashes the new password, revokes sessions, audits without any password material", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "rp-1", name: "R", password: "old-password" });
    const playerObjId = new Types.ObjectId(player.id);
    const { rawToken } = await createSession(playerObjId);

    const result = await resetPlayerPassword({ actorAdminId: adminId, playerId: player.id, newPassword: "brand-new-pw" });
    expect(result).toEqual({ ok: true });

    const stored = await User.findById(playerObjId).select("+passwordHash");
    expect(await verifyPassword("brand-new-pw", stored!.passwordHash)).toBe(true);
    expect(await verifyPassword("old-password", stored!.passwordHash)).toBe(false);
    expect(await findActiveSessionUser(rawToken)).toBeNull();

    const audit = await AuditLog.findOne({ action: "PLAYER_PASSWORD_RESET", subjectUserId: playerObjId }).lean();
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain("brand-new-pw");
    expect(JSON.stringify(audit)).not.toMatch(/scrypt-v1/);

    await expect(
      resetPlayerPassword({ actorAdminId: adminId, playerId: adminId.toHexString(), newPassword: "x" }),
    ).rejects.toMatchObject({ code: "PLAYER_NOT_FOUND" });
  });
});

// --------------------------------------------------------------------------------------------
describe("ADMIN_CREDIT", () => {
  it("moves wallet + writes an immutable ledger row + an audit row, all atomic; server computes the balance", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "cr-1", name: "C", password: "cccccccc" });
    const playerObjId = new Types.ObjectId(player.id);

    const result = await adminCreditWallet({
      actorAdminId: adminId,
      playerId: player.id,
      amountPaise: 500000,
      reason: "Manual UPI payment received",
      paymentReference: "UTR123456",
      clientRequestId: uuid(),
    });
    expect(result.wallet.availableBalancePaise).toBe(500000);
    expect(result.transaction).toMatchObject({ type: "ADMIN_CREDIT", amountPaise: 500000 });
    expect(result.idempotentReplay).toBe(false);

    const ledger = await WalletTransaction.findOne({ userId: playerObjId, type: "ADMIN_CREDIT" })
      .select("+createdByAdminId")
      .lean();
    expect(ledger).toMatchObject({
      amountPaise: 500000,
      availableDeltaPaise: 500000,
      reservedDeltaPaise: 0,
      availableBeforePaise: 0,
      availableAfterPaise: 500000,
      referenceType: "ADMIN_ADJUSTMENT",
      adminReason: "Manual UPI payment received",
      adminPaymentReference: "UTR123456",
    });
    expect(ledger!.createdByAdminId!.toString()).toBe(adminId.toString());

    const audit = await AuditLog.findOne({ action: "ADMIN_WALLET_CREDIT", subjectUserId: playerObjId }).lean();
    expect(audit?.actorAdminId.toString()).toBe(adminId.toString());
    expect(await WalletTransaction.countDocuments({ userId: playerObjId })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "ADMIN_WALLET_CREDIT" })).toBe(1);
  });

  it("rejects below ₹1 (INVALID_AMOUNT) and an ADMIN target (PLAYER_NOT_FOUND) with no writes", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "cr-2", name: "C", password: "cccccccc" });
    await expect(
      adminCreditWallet({ actorAdminId: adminId, playerId: player.id, amountPaise: 99, reason: "x", clientRequestId: uuid() }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(
      adminCreditWallet({ actorAdminId: adminId, playerId: adminId.toHexString(), amountPaise: 100, reason: "x", clientRequestId: uuid() }),
    ).rejects.toMatchObject({ code: "PLAYER_NOT_FOUND" });
    expect(await WalletTransaction.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments({ action: "ADMIN_WALLET_CREDIT" })).toBe(0);
  });
});

// --------------------------------------------------------------------------------------------
describe("ADMIN_DEBIT", () => {
  it("debits available, never below zero, never touching reserved; the prior ledger row is untouched", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "db-1", name: "D", password: "dddddddd" });
    const playerObjId = new Types.ObjectId(player.id);
    await seedWalletBalance(playerObjId, { available: 100000, reserved: 30000 });

    const wrongCredit = await adminCreditWallet({
      actorAdminId: adminId, playerId: player.id, amountPaise: 100000, reason: "accidental credit", clientRequestId: uuid(),
    });
    const creditRowBefore = await WalletTransaction.findById(wrongCredit.transaction.id).lean();

    const result = await adminDebitWallet({
      actorAdminId: adminId, playerId: player.id, amountPaise: 100000, reason: "reverse accidental credit", clientRequestId: uuid(),
    });
    expect(result.wallet.availableBalancePaise).toBe(100000); // 200000 - 100000
    expect(result.wallet.reservedBalancePaise).toBe(30000); // untouched

    await expect(
      adminDebitWallet({ actorAdminId: adminId, playerId: player.id, amountPaise: 9_999_999, reason: "overspend", clientRequestId: uuid() }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    const wallet = await Wallet.findOne({ userId: playerObjId }).lean();
    expect(wallet!.availableBalancePaise).toBe(100000);
    expect(wallet!.availableBalancePaise).toBeGreaterThanOrEqual(0);

    const creditRowAfter = await WalletTransaction.findById(wrongCredit.transaction.id).lean();
    expect(JSON.stringify(creditRowAfter)).toBe(JSON.stringify(creditRowBefore));
  });
});

// --------------------------------------------------------------------------------------------
describe("financial idempotency (brief §18)", () => {
  it("an exact replay returns the original result; a conflicting reuse is DUPLICATE_REQUEST with no second movement", async () => {
    const adminId = await makeAdmin();
    const p1 = await createPlayer({ actorAdminId: adminId, loginId: "id-1", name: "1", password: "aaaaaaaa" });
    const p2 = await createPlayer({ actorAdminId: adminId, loginId: "id-2", name: "2", password: "bbbbbbbb" });
    const rid = uuid();
    const args = { actorAdminId: adminId, playerId: p1.id, amountPaise: 100000, reason: "manual", clientRequestId: rid };

    const first = await adminCreditWallet(args);
    const replay = await adminCreditWallet(args);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.transaction.id).toBe(first.transaction.id);
    expect(await WalletTransaction.countDocuments({ userId: new Types.ObjectId(p1.id) })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "ADMIN_WALLET_CREDIT" })).toBe(1);

    await expect(adminCreditWallet({ ...args, amountPaise: 200000 })).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
    await expect(adminCreditWallet({ ...args, playerId: p2.id })).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
    await expect(adminDebitWallet(args)).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
    await expect(adminCreditWallet({ ...args, reason: "different reason entirely" })).rejects.toMatchObject({
      code: "DUPLICATE_REQUEST",
    });
    expect(await WalletTransaction.countDocuments({ userId: new Types.ObjectId(p1.id) })).toBe(1);
    expect((await Wallet.findOne({ userId: new Types.ObjectId(p1.id) }).lean())!.availableBalancePaise).toBe(100000);
  });
});

// --------------------------------------------------------------------------------------------
describe("financial concurrency (brief §30)", () => {
  it("two concurrent identical credits (same clientRequestId) move money once, one ledger, one audit", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "cc-1", name: "C", password: "cccccccc" });
    const playerObjId = new Types.ObjectId(player.id);
    const args = { actorAdminId: adminId, playerId: player.id, amountPaise: 500000, reason: "manual", clientRequestId: uuid() };

    const results = await Promise.allSettled([adminCreditWallet(args), adminCreditWallet(args)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set(
      results.map((r) => (r as PromiseFulfilledResult<{ transaction: { id: string } }>).value.transaction.id),
    );
    expect(ids.size).toBe(1);
    expect(await WalletTransaction.countDocuments({ userId: playerObjId, type: "ADMIN_CREDIT" })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "ADMIN_WALLET_CREDIT", subjectUserId: playerObjId })).toBe(1);
    expect((await Wallet.findOne({ userId: playerObjId }).lean())!.availableBalancePaise).toBe(500000);
  });

  it("two concurrent distinct debits of ₹80 on a ₹100 balance: one succeeds, one INSUFFICIENT_BALANCE, final ₹20", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "cc-2", name: "C", password: "cccccccc" });
    const playerObjId = new Types.ObjectId(player.id);
    await seedWalletBalance(playerObjId, { available: 10000 });

    const debit = () =>
      adminDebitWallet({
        actorAdminId: adminId, playerId: player.id, amountPaise: 8000, reason: "adj", clientRequestId: uuid(),
      });
    const results = await Promise.allSettled([debit(), debit()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    const wallet = await Wallet.findOne({ userId: playerObjId }).lean();
    expect(wallet!.availableBalancePaise).toBe(2000);
    expect(wallet!.availableBalancePaise).toBeGreaterThanOrEqual(0);
    expect(await WalletTransaction.countDocuments({ userId: playerObjId, type: "ADMIN_DEBIT" })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "ADMIN_WALLET_DEBIT", subjectUserId: playerObjId })).toBe(1);
  });

  it("a forced failure right after the wallet movement rolls back everything (no money, no ledger, no audit)", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "cc-3", name: "C", password: "cccccccc" });
    const playerObjId = new Types.ObjectId(player.id);

    await expect(
      adminCreditWallet(
        { actorAdminId: adminId, playerId: player.id, amountPaise: 500000, reason: "manual", clientRequestId: uuid() },
        {
          afterWalletMovement: () => {
            throw new Error("deliberate rollback");
          },
        },
      ),
    ).rejects.toThrow("deliberate rollback");

    expect((await Wallet.findOne({ userId: playerObjId }).lean())!.availableBalancePaise).toBe(0);
    expect(await WalletTransaction.countDocuments({ userId: playerObjId })).toBe(0);
    expect(await AuditLog.countDocuments({ action: "ADMIN_WALLET_CREDIT" })).toBe(0);
  });

  it("the admin idempotency key namespace is admin+request scoped", () => {
    const admin = new Types.ObjectId();
    expect(buildAdminAdjustmentKey(admin, "abc")).toContain(admin.toHexString());
  });
});

// --------------------------------------------------------------------------------------------
describe("admin wallet transaction history", () => {
  it("returns admin metadata (reason / paymentReference / actorAdminId) but never the idempotency key", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "hist-1", name: "H", password: "hhhhhhhh" });
    await adminCreditWallet({
      actorAdminId: adminId, playerId: player.id, amountPaise: 300000, reason: "UPI in", paymentReference: "UTR-9", clientRequestId: uuid(),
    });
    await adminDebitWallet({
      actorAdminId: adminId, playerId: player.id, amountPaise: 100000, reason: "correction", clientRequestId: uuid(),
    });

    const page = await listPlayerWalletTransactionsForAdmin(player.id, {});
    expect(page.transactions.map((t) => t.type)).toEqual(["ADMIN_DEBIT", "ADMIN_CREDIT"]); // newest first
    const credit = page.transactions.find((t) => t.type === "ADMIN_CREDIT")!;
    expect(credit).toMatchObject({ reason: "UPI in", paymentReference: "UTR-9", actorAdminId: adminId.toString() });
    for (const row of page.transactions) {
      expect(row).not.toHaveProperty("idempotencyKey");
      expect(row).not.toHaveProperty("adminReason");
    }
  });
});

// --------------------------------------------------------------------------------------------
describe("playerDeletionService.purgePlayer (brief §31)", () => {
  it("removes every identifying / owned record and leaves only a non-identifying completion audit", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "purge-1", name: "P", password: "pppppppp", phone: "9123456780" });
    const playerObjId = new Types.ObjectId(player.id);

    // Representative data across every player-owned collection.
    const { rawToken } = await createSession(playerObjId);
    await OtpRequest.create({ userId: playerObjId, codeHash: "x", purpose: "LOGIN", expiresAt: new Date(Date.now() + 60000) });
    await adminCreditWallet({ actorAdminId: adminId, playerId: player.id, amountPaise: 500000, reason: "seed", clientRequestId: uuid() });
    const bet = await Bet.create({
      publicRef: "PURGE-0001", clientRequestId: uuid(), userId: playerObjId,
      marketId: new Types.ObjectId(), marketRoundId: new Types.ObjectId(),
      entryMethod: "JODI", entryMetadata: { numbers: ["07"] },
      selections: [{ number: "07", stakePaise: 100 }], totalStakePaise: 100, totalSelections: 1,
      payoutMultiplierSnapshot: 90, status: "ACTIVE", version: 1, placedAt: new Date(),
    });
    await BetRevision.create({
      betId: bet._id, userId: playerObjId, fromVersion: 1, toVersion: 2,
      before: { entryMethod: "JODI", entryMetadata: { numbers: ["07"] }, selections: [{ number: "07", stakePaise: 100 }], totalStakePaise: 100 },
      after: { entryMethod: "JODI", entryMetadata: { numbers: ["07"] }, selections: [{ number: "07", stakePaise: 200 }], totalStakePaise: 200 },
      walletDeltaPaise: -100, editRequestId: uuid(), editedAt: new Date(),
    });
    await Withdrawal.create({
      userId: playerObjId, clientRequestId: uuid(), method: "UPI", paymentDetails: { upiId: "p@bank" },
      destinationSummary: "p•@bank", amountPaise: 100, status: "PENDING", requestedAt: new Date(),
    });

    await playerDeletionService.purgePlayer({ actorAdminId: adminId, playerId: playerObjId });

    expect(await User.countDocuments({ _id: playerObjId })).toBe(0);
    expect(await Session.countDocuments({ userId: playerObjId })).toBe(0);
    expect(await OtpRequest.countDocuments({ userId: playerObjId })).toBe(0);
    expect(await Wallet.countDocuments({ userId: playerObjId })).toBe(0);
    expect(await WalletTransaction.countDocuments({ userId: playerObjId })).toBe(0);
    expect(await Bet.countDocuments({ userId: playerObjId })).toBe(0);
    expect(await BetRevision.countDocuments({ userId: playerObjId })).toBe(0);
    expect(await BetRevision.countDocuments({ betId: bet._id })).toBe(0);
    expect(await Withdrawal.countDocuments({ userId: playerObjId })).toBe(0);
    expect(await AuditLog.countDocuments({ subjectUserId: playerObjId })).toBe(0);
    expect(await AuditLog.countDocuments({ entityId: playerObjId })).toBe(0);
    expect(await findActiveSessionUser(rawToken)).toBeNull();

    const survivor = await AuditLog.findOne({ action: "PLAYER_DELETION_COMPLETED" }).lean();
    expect(survivor).toBeTruthy();
    expect(survivor!.actorAdminId.toString()).toBe(adminId.toString());
    expect(survivor!.subjectUserId ?? null).toBeNull();
    expect(survivor!.entityId ?? null).toBeNull();
    expect(survivor!.before ?? null).toBeNull();
    expect(survivor!.after ?? null).toBeNull();
    const blob = JSON.stringify(survivor);
    expect(blob).not.toContain("purge-1");
    expect(blob).not.toContain(playerObjId.toString());
    expect(blob).not.toContain("9123456780");

    // the freed loginId can back a brand-new, unrelated account
    const recreated = await createPlayer({ actorAdminId: adminId, loginId: "purge-1", name: "New Person", password: "zzzzzzzz" });
    expect(recreated.id).not.toBe(player.id);
  });

  it("refuses to purge an ADMIN target and leaves it intact", async () => {
    const adminId = await makeAdmin();
    const victimAdmin = await makeAdmin();
    await expect(
      playerDeletionService.purgePlayer({ actorAdminId: adminId, playerId: victimAdmin }),
    ).rejects.toMatchObject({ code: "PLAYER_NOT_FOUND" });
    expect(await User.countDocuments({ _id: victimAdmin })).toBe(1);
  });
});

// --------------------------------------------------------------------------------------------
describe("wallet concurrency primitive stays safe alongside existing player operations", () => {
  it("an ADMIN_CREDIT composed in the same transaction as a reserve leaves consistent balances", async () => {
    const adminId = await makeAdmin();
    const player = await createPlayer({ actorAdminId: adminId, loginId: "mix-1", name: "M", password: "mmmmmmmm" });
    const playerObjId = new Types.ObjectId(player.id);
    await seedWalletBalance(playerObjId, { available: 100000 });

    await withTransaction(async (session) => {
      await creditAvailableInSession(
        { userId: playerObjId, type: "ADMIN_CREDIT", amountPaise: 50000, idempotencyKey: `t:${uuid()}`, actorAdminId: adminId },
        session,
      );
      await reserveInSession({ userId: playerObjId, amountPaise: 30000, idempotencyKey: `t:${uuid()}` }, session);
    });

    const wallet = await Wallet.findOne({ userId: playerObjId }).lean();
    expect(wallet!.availableBalancePaise).toBe(120000); // 100000 + 50000 - 30000
    expect(wallet!.reservedBalancePaise).toBe(30000);
  });
});
