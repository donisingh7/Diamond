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
import { Market } from "@/modules/markets/models/market.model";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { BetRevision } from "@/modules/betting/models/bet-revision.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { AuditLog } from "@/modules/audit/models/audit-log.model";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import { mockDeposit } from "@/modules/wallet/services/mock-deposit.service";
import { placeBetRequestSchema } from "@/modules/betting/validators/place-bet-input";
import { placeBet } from "@/modules/betting/services/bet-placement.service";
import { settleDeclaredRound } from "@/modules/admin/services/admin-settlement.service";

/**
 * Window 7A2 — admin settlement orchestration. Service-layer behaviour of `settleDeclaredRound`
 * over the Window 7A1 engine: round resolution + rejection, one audit row per real settlement,
 * and replay / concurrency safety (no double credit, no second audit row). The engine's own
 * money guarantees are the 7A1 suite's job and are not re-proved here.
 */

let replica: MongoMemoryReplSet | undefined;

const ist = (value: string) => new Date(`${value}+05:30`);
/** Faridabad 2026-09-06: opens 07:00, closes 17:50 (IST). */
const OPEN = ist("2026-09-06T12:00:00");

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_admin_settlement"));
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
    Market.deleteMany({}),
    MarketRound.deleteMany({}),
    Bet.deleteMany({}),
    BetRevision.deleteMany({}),
    Wallet.deleteMany({}),
    WalletTransaction.deleteMany({}),
    AuditLog.deleteMany({}),
    PlatformSettings.deleteMany({}),
  ]);
  await seedFoundation();
});

let counter = 0;

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

async function makePlayer(): Promise<Types.ObjectId> {
  counter += 1;
  const user = await User.create({
    role: "PLAYER",
    loginId: `player-${Date.now()}-${counter}`,
    name: `Player ${counter}`,
    passwordHash: "test-fixture",
    status: "ACTIVE",
  });
  return user._id;
}

const fund = (userId: Types.ObjectId, amountPaise: number) =>
  mockDeposit({ userId, amountPaise, clientRequestId: randomUUID() });

async function placeJodi(
  userId: Types.ObjectId,
  numbers: string[],
  perNumberStakePaise: number,
): Promise<{ betId: Types.ObjectId; roundId: Types.ObjectId }> {
  const request = placeBetRequestSchema.parse({
    marketSlug: "faridabad",
    entryMethod: "JODI",
    numbers,
    stakePaise: perNumberStakePaise,
    clientRequestId: randomUUID(),
  });
  const receipt = await placeBet({ userId, request }, { clock: () => OPEN });
  const bet = await Bet.findById(receipt.bet.id);
  return { betId: bet!._id, roundId: bet!.marketRoundId };
}

/** Stamp a declared result on the round (6A2 fixture convention); `settlementStatus` stays PENDING. */
async function declareResult(roundId: Types.ObjectId, result: string): Promise<void> {
  const round = await MarketRound.findById(roundId).lean();
  await MarketRound.updateOne(
    { _id: roundId },
    { $set: { result, resultDeclaredAt: round!.closesAt, declaredByAdminId: new Types.ObjectId() } },
    { runValidators: true },
  );
}

async function roundRef(roundId: Types.ObjectId): Promise<{ marketId: string; businessDate: string }> {
  const round = await MarketRound.findById(roundId).lean();
  return { marketId: round!.marketId.toString(), businessDate: round!.businessDate };
}

const available = async (userId: Types.ObjectId) =>
  (await Wallet.findOne({ userId }).lean())!.availableBalancePaise;
const settledAudits = () => AuditLog.countDocuments({ action: "ROUND_SETTLED" });
const winCredits = () => WalletTransaction.countDocuments({ type: "WIN_CREDIT" });

// -------------------------------------------------------------------------------------------

describe("settleDeclaredRound — happy path", () => {
  it("an ADMIN settles a declared round: engine summary + exactly one ROUND_SETTLED audit row", async () => {
    const adminId = await makeAdmin();
    const winner = await makePlayer();
    const loser = await makePlayer();
    await fund(winner, 1_00_000);
    await fund(loser, 1_00_000);

    const { roundId } = await placeJodi(winner, ["07", "22"], 1_000); // 2000 stake → available 98000
    await placeJodi(loser, ["11", "22"], 1_000);
    await declareResult(roundId, "07");
    const { marketId, businessDate } = await roundRef(roundId);

    const settlement = await settleDeclaredRound({ actorAdminId: adminId, marketId, businessDate });

    expect(settlement).toMatchObject({
      settlementStatus: "SETTLED",
      alreadySettled: false,
      auditWritten: true,
      result: "07",
      wonCount: 1,
      lostCount: 1,
      totalBets: 2,
      totalCreditedPaise: 90_000,
      market: { slug: "faridabad" },
    });
    expect(await available(winner)).toBe(98_000 + 90_000);
    expect(await available(loser)).toBe(98_000);

    expect(await settledAudits()).toBe(1);
    const row = await AuditLog.findOne({ action: "ROUND_SETTLED" }).lean();
    expect(row!.actorAdminId.toString()).toBe(adminId.toString());
    expect(row!.entityType).toBe("MarketRound");
    expect(row!.entityId!.toString()).toBe(roundId.toString());
    // A lean read of a Map-typed path comes back as a plain object.
    expect(row!.after as unknown as Record<string, unknown>).toMatchObject({
      result: "07",
      settlementStatus: "SETTLED",
      totalCreditedPaise: 90_000,
    });

    const round = await MarketRound.findById(roundId).lean();
    expect(round!.settlementStatus).toBe("SETTLED");
    expect(round!.result).toBe("07"); // settlement never touches the declared result
  });
});

describe("settleDeclaredRound — rejections", () => {
  it("an unknown round (no round for the market + businessDate) is ROUND_NOT_FOUND", async () => {
    const adminId = await makeAdmin();
    const market = await Market.findOne({ slug: "faridabad" }).lean();
    await expect(
      settleDeclaredRound({ actorAdminId: adminId, marketId: market!._id.toString(), businessDate: "2099-01-01" }),
    ).rejects.toMatchObject({ code: "ROUND_NOT_FOUND" });
    expect(await settledAudits()).toBe(0);
  });

  it("a round with no declared result is RESULT_NOT_DECLARED and neither audits nor moves money", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    await fund(player, 1_00_000);
    const { roundId } = await placeJodi(player, ["07", "22"], 1_000);
    const { marketId, businessDate } = await roundRef(roundId);

    await expect(
      settleDeclaredRound({ actorAdminId: adminId, marketId, businessDate }),
    ).rejects.toMatchObject({ code: "RESULT_NOT_DECLARED" });

    expect(await settledAudits()).toBe(0);
    expect(await winCredits()).toBe(0);
    expect(await available(player)).toBe(98_000);
  });
});

describe("settleDeclaredRound — replay & concurrency", () => {
  it("an exact replay returns the settled summary, adds no audit row and does not re-credit", async () => {
    const adminId = await makeAdmin();
    const winner = await makePlayer();
    await fund(winner, 1_00_000);
    const { roundId } = await placeJodi(winner, ["07", "22"], 1_000);
    await declareResult(roundId, "07");
    const { marketId, businessDate } = await roundRef(roundId);

    const first = await settleDeclaredRound({ actorAdminId: adminId, marketId, businessDate });
    const balanceAfterFirst = await available(winner);
    const replay = await settleDeclaredRound({ actorAdminId: adminId, marketId, businessDate });

    expect(first).toMatchObject({ alreadySettled: false, auditWritten: true });
    expect(replay).toMatchObject({ alreadySettled: true, auditWritten: false, settlementStatus: "SETTLED" });
    expect(replay.totalCreditedPaise).toBe(first.totalCreditedPaise);
    expect(await available(winner)).toBe(balanceAfterFirst);
    expect(await winCredits()).toBe(1);
    expect(await settledAudits()).toBe(1);
  });

  it("repeated concurrent invocations settle once: one credit, one audit row", async () => {
    const adminId = await makeAdmin();
    const winner = await makePlayer();
    await fund(winner, 1_00_000);
    const { roundId } = await placeJodi(winner, ["07", "22"], 1_000);
    await declareResult(roundId, "07");
    const { marketId, businessDate } = await roundRef(roundId);
    const input = { actorAdminId: adminId, marketId, businessDate };

    const results = await Promise.allSettled([
      settleDeclaredRound(input),
      settleDeclaredRound(input),
      settleDeclaredRound(input),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const values = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof settleDeclaredRound>>>).value);
    expect(values.filter((v) => v.auditWritten)).toHaveLength(1);
    expect(values.every((v) => v.settlementStatus === "SETTLED")).toBe(true);

    expect(await winCredits()).toBe(1);
    expect(await settledAudits()).toBe(1);
    expect(await available(winner)).toBe(98_000 + 90_000);
  });
});
