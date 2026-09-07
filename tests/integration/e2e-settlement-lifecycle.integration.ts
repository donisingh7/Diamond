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
import { editBetRequestSchema } from "@/modules/betting/validators/edit-bet-input";
import { editBet } from "@/modules/betting/services/bet-edit.service";
import { settleDeclaredRound } from "@/modules/admin/services/admin-settlement.service";

/**
 * Window 7B — one high-value cross-domain chain that no single-window suite proves:
 * place a bet → EDIT its stake → admin declares the result → admin settles → the winning
 * credit is the POST-EDIT stake at the bet's frozen snapshot multiplier, exactly once, and a
 * settlement replay never credits again. The per-window suites cover place, edit and settle in
 * isolation; this guards the seam between Window 4B (edit) and Window 7A (settlement).
 */

let replica: MongoMemoryReplSet | undefined;

const ist = (value: string) => new Date(`${value}+05:30`);
/** Faridabad 2026-09-06: opens 07:00, edit cutoff 16:50, closes 17:50 (IST). */
const OPEN = ist("2026-09-06T12:00:00");
const BEFORE_CUTOFF = ist("2026-09-06T16:49:59");

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_e2e_settlement"));
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
    loginId: `e2e-admin-${Date.now()}-${counter}`,
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
    loginId: `e2e-player-${Date.now()}-${counter}`,
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
): Promise<{ betId: string; publicRef: string; roundId: Types.ObjectId }> {
  const request = placeBetRequestSchema.parse({
    marketSlug: "faridabad",
    entryMethod: "JODI",
    numbers,
    stakePaise: perNumberStakePaise,
    clientRequestId: randomUUID(),
  });
  const receipt = await placeBet({ userId, request }, { clock: () => OPEN });
  const bet = await Bet.findById(receipt.bet.id);
  return { betId: receipt.bet.id, publicRef: receipt.bet.publicRef, roundId: bet!.marketRoundId };
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
const winCreditRows = (betId: Types.ObjectId) =>
  WalletTransaction.countDocuments({ type: "WIN_CREDIT", referenceId: betId });

// -------------------------------------------------------------------------------------------

describe("E2E — edited stake settles at the frozen snapshot rate, exactly once", () => {
  it("place → raise stake via editBet → declare → admin settle: WIN_CREDIT is the post-edit stake × snapshot, replay-safe", async () => {
    const adminId = await makeAdmin();
    const player = await makePlayer();
    await fund(player, 10_00_000);

    // Place JODI on 07 + 22 at ₹10 each (2000 paise total).
    const { betId, publicRef, roundId } = await placeJodi(player, ["07", "22"], 1_000);
    expect(await available(player)).toBe(10_00_000 - 2_000);

    // Edit BEFORE the cutoff: raise both selections to ₹25 each (5000 total) — a 3000 BET_EDIT_DEBIT.
    const edited = await editBet(
      {
        userId: player,
        betRef: publicRef,
        request: editBetRequestSchema.parse({
          entryMethod: "JODI",
          numbers: ["07", "22"],
          stakePaise: 2_500,
          expectedVersion: 1,
          editRequestId: randomUUID(),
        }),
      },
      { clock: () => BEFORE_CUTOFF },
    );
    expect(edited.version).toBe(2);
    const winningStakePaise = edited.selections.find((s) => s.number === "07")!.stakePaise;
    expect(winningStakePaise).toBe(2_500);
    const snapshot = edited.payoutMultiplierSnapshot;
    const expectedCreditPaise = winningStakePaise * snapshot;
    expect(await available(player)).toBe(10_00_000 - 5_000);

    // Move the platform rate AFTER the edit — settlement must ignore it and use the bet snapshot.
    await PlatformSettings.updateOne({ key: "platform" }, { $set: { payoutMultiplier: snapshot + 5 } });

    // Admin declares 07, then settles the declared round.
    await declareResult(roundId, "07");
    const { marketId, businessDate } = await roundRef(roundId);
    const settlement = await settleDeclaredRound({ actorAdminId: adminId, marketId, businessDate });

    expect(settlement).toMatchObject({
      settlementStatus: "SETTLED",
      alreadySettled: false,
      auditWritten: true,
      result: "07",
      wonCount: 1,
      lostCount: 0,
      totalBets: 1,
      totalStakePaise: 5_000,
      totalCreditedPaise: expectedCreditPaise,
    });

    const betObjectId = new Types.ObjectId(betId);
    const settledBet = await Bet.findById(betObjectId).lean();
    expect(settledBet!.status).toBe("WON");
    expect(settledBet!.winningNumber).toBe("07");
    expect(settledBet!.payoutPaise).toBe(expectedCreditPaise);
    expect(settledBet!.version).toBe(2); // settlement never bumps the edit version

    expect(await winCreditRows(betObjectId)).toBe(1);
    const creditRow = await WalletTransaction.findOne({ type: "WIN_CREDIT", referenceId: betObjectId }).lean();
    expect(creditRow!.amountPaise).toBe(expectedCreditPaise);
    expect(creditRow!.idempotencyKey).toBe(`WIN_CREDIT:${betId}`);
    expect(await available(player)).toBe(10_00_000 - 5_000 + expectedCreditPaise);

    // Replay the admin settlement — no second credit, no version churn, summary is stable.
    const balanceBeforeReplay = await available(player);
    const replay = await settleDeclaredRound({ actorAdminId: adminId, marketId, businessDate });
    expect(replay).toMatchObject({ alreadySettled: true, auditWritten: false, settlementStatus: "SETTLED" });
    expect(replay.totalCreditedPaise).toBe(expectedCreditPaise);
    expect(await winCreditRows(betObjectId)).toBe(1);
    expect(await available(player)).toBe(balanceBeforeReplay);
    expect(await AuditLog.countDocuments({ action: "ROUND_SETTLED" })).toBe(1);
  });
});
