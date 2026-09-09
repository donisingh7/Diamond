import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "@/lib/db/connection";
import { ensureIndexes } from "@/lib/db/models";
import { seedFoundation } from "@/modules/settings/services/seed-foundation";
import { User } from "@/modules/users/models/user.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { AuditLog } from "@/modules/audit/models/audit-log.model";
import { PaymentMethod } from "@/modules/payments/models/payment-method.model";
import { DepositRequest } from "@/modules/payments/models/deposit-request.model";
import { ProofImage } from "@/modules/payments/models/proof-image.model";
import {
  createPaymentMethod,
  listActivePaymentMethodsForPlayer,
  updatePaymentMethod,
} from "@/modules/payments/services/payment-method.service";
import {
  approveDepositRequest,
  getPlayerDepositRequest,
  rejectDepositRequest,
  submitDepositRequest,
} from "@/modules/payments/services/deposit-request.service";
import { getImageForViewer, storeImage } from "@/modules/payments/services/proof-image.service";
import { DomainError } from "@/lib/errors/domain-error";

/**
 * Window 10A — manual Add Money, end to end at the service layer against a real replica set.
 * The HTTP guards (requirePlayer / requireAdmin / isTrustedOrigin / strict Zod) are structural
 * and covered by the route files + `tests/payments.test.ts`; this proves the domain + money
 * behaviour: PENDING creation, retry / UTR dedupe, an admin-editable approved amount, a single
 * `DEPOSIT_CREDIT` under replay AND concurrency, reject-credits-nothing, and snapshot immunity
 * to later payment-method edits.
 */

let replica: MongoMemoryReplSet | undefined;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_deposits"));
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
    AuditLog.deleteMany({}),
    PaymentMethod.deleteMany({}),
    DepositRequest.deleteMany({}),
    ProofImage.deleteMany({}),
  ]);
  await seedFoundation();
});

let counter = 0;
async function makeAdmin(): Promise<Types.ObjectId> {
  counter += 1;
  const admin = await User.create({ role: "ADMIN", loginId: `dep-admin-${Date.now()}-${counter}`, name: "Admin", passwordHash: "fixture", status: "ACTIVE" });
  return admin._id;
}
async function makePlayer(): Promise<Types.ObjectId> {
  counter += 1;
  const user = await User.create({ role: "PLAYER", loginId: `dep-player-${Date.now()}-${counter}`, name: "Player", passwordHash: "fixture", status: "ACTIVE" });
  return user._id;
}
const available = async (userId: Types.ObjectId) =>
  (await Wallet.findOne({ userId }).lean())?.availableBalancePaise ?? 0;
const depositCredits = (referenceId: Types.ObjectId) =>
  WalletTransaction.countDocuments({ type: "DEPOSIT_CREDIT", referenceId });

async function activeUpiMethod(adminId: Types.ObjectId, over: Record<string, unknown> = {}) {
  return createPaymentMethod({
    actorAdminId: adminId,
    request: { type: "UPI", displayName: "Main UPI", upiId: "diamond@okhdfc", ...over } as never,
  });
}
async function proofFor(userId: Types.ObjectId) {
  const stored = await storeImage({ ownerId: userId, kind: "DEPOSIT_PROOF", contentType: "image/png", bytes: PNG });
  return stored.id;
}
async function submit(userId: Types.ObjectId, methodId: string, over: Record<string, unknown> = {}) {
  return submitDepositRequest({
    userId,
    request: {
      paymentMethodId: methodId,
      requestedAmountPaise: 500_000,
      utr: `AXIS-${counter}-${Math.floor(Math.random() * 1e6)}`,
      proofImageId: await proofFor(userId),
      clientRequestId: randomUUID(),
      ...over,
    } as never,
  });
}

// ---------------------------------------------------------------------------------------

describe("payment methods — player visibility", () => {
  it("lists ACTIVE methods only, with full pay-to coordinates", async () => {
    const adminId = await makeAdmin();
    await activeUpiMethod(adminId, { displayName: "Live UPI" });
    const hidden = await activeUpiMethod(adminId, { displayName: "Old UPI", upiId: "old@okaxis" });
    await updatePaymentMethod({ actorAdminId: adminId, id: hidden.id, patch: { isActive: false } });

    const visible = await listActivePaymentMethodsForPlayer();
    expect(visible.map((m) => m.displayName)).toEqual(["Live UPI"]);
    expect(visible[0].upiId).toBe("diamond@okhdfc");
  });
});

describe("submit deposit request", () => {
  it("a valid submission becomes PENDING with a frozen snapshot", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);

    const deposit = await submit(player, method.id, { requestedAmountPaise: 750_000 });
    expect(deposit).toMatchObject({
      status: "PENDING",
      requestedAmountPaise: 750_000,
      approvedAmountPaise: null,
      paymentMethodId: method.id,
    });
    expect(deposit.paymentMethodSnapshot).toMatchObject({ type: "UPI", displayName: "Main UPI", upiId: "diamond@okhdfc" });
    expect(await available(player)).toBe(0);
  });

  it("rejects a submission against an INACTIVE method", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);
    await updatePaymentMethod({ actorAdminId: adminId, id: method.id, patch: { isActive: false } });

    await expect(submit(player, method.id)).rejects.toMatchObject({ code: "PAYMENT_METHOD_INACTIVE" });
  });

  it("is retry-safe on clientRequestId — one row, same id", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const clientRequestId = randomUUID();
    const proofImageId = await proofFor(player);

    const first = await submitDepositRequest({
      userId: player,
      request: { paymentMethodId: method.id, requestedAmountPaise: 500_000, utr: "AXIS-RETRY-1", proofImageId, clientRequestId } as never,
    });
    const replay = await submitDepositRequest({
      userId: player,
      request: { paymentMethodId: method.id, requestedAmountPaise: 500_000, utr: "AXIS-RETRY-1", proofImageId, clientRequestId } as never,
    });
    expect(replay.id).toBe(first.id);
    expect(await DepositRequest.countDocuments({ userId: player })).toBe(1);
  });

  it("rejects a duplicate normalized UTR from anyone", async () => {
    const adminId = await makeAdmin();
    const a = await makePlayer();
    const b = await makePlayer();
    const method = await activeUpiMethod(adminId);

    await submit(a, method.id, { utr: "AXIS 4477 1", proofImageId: await proofFor(a) });
    await expect(submit(b, method.id, { utr: "axis-44771", proofImageId: await proofFor(b) })).rejects.toMatchObject({
      code: "DUPLICATE_UTR",
    });
  });

  it("rejects a proof that belongs to another player", async () => {
    const adminId = await makeAdmin();
    const owner = await makePlayer();
    const attacker = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const othersProof = await proofFor(owner);

    await expect(
      submitDepositRequest({
        userId: attacker,
        request: { paymentMethodId: method.id, requestedAmountPaise: 500_000, utr: "AXIS-STEAL-1", proofImageId: othersProof, clientRequestId: randomUUID() } as never,
      }),
    ).rejects.toMatchObject({ code: "IMAGE_NOT_FOUND" });
  });

  it("a player sees only their own deposit requests", async () => {
    const adminId = await makeAdmin();
    const a = await makePlayer();
    const b = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const mine = await submit(a, method.id);

    await expect(getPlayerDepositRequest(b, mine.id)).rejects.toMatchObject({ code: "DEPOSIT_REQUEST_NOT_FOUND" });
    expect((await getPlayerDepositRequest(a, mine.id)).id).toBe(mine.id);
  });
});

describe("admin review — approve", () => {
  it("approves the requested amount: status APPROVED, one DEPOSIT_CREDIT, wallet credited once", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const deposit = await submit(player, method.id, { requestedAmountPaise: 500_000 });

    const approved = await approveDepositRequest({ actorAdminId: adminId, depositRequestId: deposit.id, approvedAmountPaise: 500_000 });
    expect(approved).toMatchObject({ status: "APPROVED", requestedAmountPaise: 500_000, approvedAmountPaise: 500_000 });
    expect(await available(player)).toBe(500_000);
    expect(await depositCredits(new Types.ObjectId(deposit.id))).toBe(1);
    expect(await AuditLog.countDocuments({ action: "DEPOSIT_APPROVED" })).toBe(1);
  });

  it("approves a LOWER amount with a remark; the requested amount is never overwritten", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const deposit = await submit(player, method.id, { requestedAmountPaise: 500_000 });

    const approved = await approveDepositRequest({
      actorAdminId: adminId,
      depositRequestId: deposit.id,
      approvedAmountPaise: 450_000,
      adminRemark: "Bank statement shows ₹4,500 only",
    });
    expect(approved).toMatchObject({ requestedAmountPaise: 500_000, approvedAmountPaise: 450_000, status: "APPROVED" });
    expect(await available(player)).toBe(450_000);
  });

  it("approves a HIGHER amount with a remark", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const deposit = await submit(player, method.id, { requestedAmountPaise: 500_000 });

    await approveDepositRequest({
      actorAdminId: adminId,
      depositRequestId: deposit.id,
      approvedAmountPaise: 600_000,
      adminRemark: "Extra ₹1,000 received; credited in full",
    });
    expect(await available(player)).toBe(600_000);
  });

  it("refuses a different approved amount with no remark, and moves nothing", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const deposit = await submit(player, method.id, { requestedAmountPaise: 500_000 });

    await expect(
      approveDepositRequest({ actorAdminId: adminId, depositRequestId: deposit.id, approvedAmountPaise: 450_000 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await available(player)).toBe(0);
    expect(await DepositRequest.findById(deposit.id).then((d) => d!.status)).toBe("PENDING");
  });

  it("an exact replay of approve does not double-credit", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const deposit = await submit(player, method.id, { requestedAmountPaise: 500_000 });

    await approveDepositRequest({ actorAdminId: adminId, depositRequestId: deposit.id, approvedAmountPaise: 500_000 });
    const replay = await approveDepositRequest({ actorAdminId: adminId, depositRequestId: deposit.id, approvedAmountPaise: 500_000 });
    expect(replay.status).toBe("APPROVED");
    expect(await available(player)).toBe(500_000);
    expect(await depositCredits(new Types.ObjectId(deposit.id))).toBe(1);
    expect(await AuditLog.countDocuments({ action: "DEPOSIT_APPROVED" })).toBe(1);
  });

  it("three concurrent approvals credit exactly once", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const deposit = await submit(player, method.id, { requestedAmountPaise: 500_000 });

    const results = await Promise.allSettled(
      [0, 1, 2].map(() =>
        approveDepositRequest({ actorAdminId: adminId, depositRequestId: deposit.id, approvedAmountPaise: 500_000 }),
      ),
    );
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await available(player)).toBe(500_000);
    expect(await depositCredits(new Types.ObjectId(deposit.id))).toBe(1);
    expect(await AuditLog.countDocuments({ action: "DEPOSIT_APPROVED", entityId: new Types.ObjectId(deposit.id) })).toBe(1);
  });
});

describe("admin review — reject", () => {
  it("rejects with a remark and moves no money; a rejected request can never credit", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const deposit = await submit(player, method.id, { requestedAmountPaise: 500_000 });

    const rejected = await rejectDepositRequest({ actorAdminId: adminId, depositRequestId: deposit.id, adminRemark: "Proof did not match the UTR" });
    expect(rejected).toMatchObject({ status: "REJECTED", approvedAmountPaise: null, adminRemark: "Proof did not match the UTR" });
    expect(await available(player)).toBe(0);
    expect(await depositCredits(new Types.ObjectId(deposit.id))).toBe(0);
    expect(await AuditLog.countDocuments({ action: "DEPOSIT_REJECTED" })).toBe(1);

    await expect(
      approveDepositRequest({ actorAdminId: adminId, depositRequestId: deposit.id, approvedAmountPaise: 500_000 }),
    ).rejects.toMatchObject({ code: "DEPOSIT_NOT_PENDING" });
    expect(await available(player)).toBe(0);
  });

  it("reject requires a non-empty remark", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId);
    const deposit = await submit(player, method.id);
    await expect(
      rejectDepositRequest({ actorAdminId: adminId, depositRequestId: deposit.id, adminRemark: "   " }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("snapshot immunity", () => {
  it("editing or deactivating a payment method never rewrites an existing request's snapshot", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    const method = await activeUpiMethod(adminId, { displayName: "UPI v1", upiId: "v1@okhdfc" });
    const deposit = await submit(player, method.id);

    await updatePaymentMethod({
      actorAdminId: adminId,
      id: method.id,
      patch: { displayName: "UPI v2 (renamed)", upiId: "v2@okaxis", isActive: false },
    });

    const stored = await getPlayerDepositRequest(player, deposit.id);
    expect(stored.paymentMethodSnapshot).toMatchObject({ displayName: "UPI v1", upiId: "v1@okhdfc" });
  });
});

describe("proof image access", () => {
  it("a QR is readable by any signed-in user; a proof only by its owner or an admin", async () => {
    const adminId = await makeAdmin();
    const owner = await makePlayer();
    const other = await makePlayer();

    const qr = await storeImage({ ownerId: adminId, kind: "QR", contentType: "image/png", bytes: PNG });
    const proof = await storeImage({ ownerId: owner, kind: "DEPOSIT_PROOF", contentType: "image/png", bytes: PNG });

    expect((await getImageForViewer(qr.id, { _id: other, role: "PLAYER" })).contentType).toBe("image/png");
    expect((await getImageForViewer(proof.id, { _id: owner, role: "PLAYER" })).sizeBytes).toBe(PNG.byteLength);
    expect((await getImageForViewer(proof.id, { _id: adminId, role: "ADMIN" })).sizeBytes).toBe(PNG.byteLength);
    await expect(getImageForViewer(proof.id, { _id: other, role: "PLAYER" })).rejects.toMatchObject({ code: "IMAGE_NOT_FOUND" });
  });
});
