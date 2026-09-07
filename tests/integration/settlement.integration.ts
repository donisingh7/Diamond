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
import {
  settleRound,
  settleRoundBatch,
  winCreditKey,
} from "@/modules/settlement/services/settlement.service";

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
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_settlement"));
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
    loginId: `settlement-player-${playerCounter}`,
    name: "Settlement Player",
    passwordHash: "test-fixture",
  });
  return user._id;
}

async function fund(userId: Types.ObjectId, amountPaise: number): Promise<void> {
  await mockDeposit({ userId, amountPaise, clientRequestId: randomUUID() });
}

/** Place a JODI bet (each number staked `perNumberStakePaise`) as `userId` while Faridabad is open. */
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

/** Directly stamp a declared result on the round (fixture path — mirrors the 6A2 test convention);
 *  `settlementStatus` stays `PENDING`. */
async function declareResult(roundId: Types.ObjectId, result: string): Promise<void> {
  const round = await MarketRound.findById(roundId).lean();
  await MarketRound.updateOne(
    { _id: roundId },
    {
      $set: {
        result,
        resultDeclaredAt: round!.closesAt,
        declaredByAdminId: new Types.ObjectId(),
      },
    },
    { runValidators: true },
  );
}

async function available(userId: Types.ObjectId): Promise<number> {
  const wallet = await Wallet.findOne({ userId }).lean();
  return wallet!.availableBalancePaise;
}

const winCreditRows = (betId?: Types.ObjectId) =>
  WalletTransaction.countDocuments(betId ? { type: "WIN_CREDIT", referenceId: betId } : { type: "WIN_CREDIT" });

// -------------------------------------------------------------------------------------------

describe("settleRound — winner at 90x", () => {
  it("credits stake × snapshot for the matching selection only, once, as a WIN_CREDIT ledger row", async () => {
    const userId = await createPlayer();
    await fund(userId, 1_00_000);
    const { betId, roundId } = await placeJodi(userId, ["07", "22", "48"], 1_000);
    expect(await available(userId)).toBe(97_000); // 100000 − 3×1000 stake

    await declareResult(roundId, "07");
    const summary = await settleRound(roundId);

    const bet = await Bet.findById(betId).lean();
    expect(bet!.status).toBe("WON");
    expect(bet!.winningNumber).toBe("07");
    expect(bet!.payoutPaise).toBe(90_000); // 1000 × 90 — NOT 3000 × 90
    expect(bet!.settledAt).toBeInstanceOf(Date);

    expect(await available(userId)).toBe(97_000 + 90_000);
    expect(await winCreditRows(betId)).toBe(1);
    const row = await WalletTransaction.findOne({ type: "WIN_CREDIT", referenceId: betId }).lean();
    expect(row).toMatchObject({
      amountPaise: 90_000,
      availableDeltaPaise: 90_000,
      reservedDeltaPaise: 0,
      availableBeforePaise: 97_000,
      availableAfterPaise: 187_000,
      referenceType: "BET",
      idempotencyKey: winCreditKey(betId),
    });

    expect(summary).toMatchObject({
      alreadySettled: false,
      processedBets: 1,
      creditedThisRunPaise: 90_000,
      totalBets: 1,
      wonCount: 1,
      lostCount: 0,
      totalStakePaise: 3_000,
      totalCreditedPaise: 90_000,
      settlementStatus: "SETTLED",
    });

    const round = await MarketRound.findById(roundId).lean();
    expect(round!.settlementStatus).toBe("SETTLED");
    expect(round!.settledAt).toBeInstanceOf(Date);
    expect(round!.settlementSummary).toMatchObject({
      totalBets: 1,
      winningBets: 1,
      losingBets: 0,
      totalStakePaise: 3_000,
      totalPayoutPaise: 90_000,
    });
  });
});

describe("settleRound — leading-zero result", () => {
  it("matches a '00' selection as a string and pays it", async () => {
    const userId = await createPlayer();
    await fund(userId, 1_00_000);
    const { betId, roundId } = await placeJodi(userId, ["00", "07", "93"], 1_000);

    await declareResult(roundId, "00");
    await settleRound(roundId);

    const bet = await Bet.findById(betId).lean();
    expect(bet!.status).toBe("WON");
    expect(bet!.winningNumber).toBe("00");
    expect(bet!.payoutPaise).toBe(90_000);
    expect(await available(userId)).toBe(97_000 + 90_000);
  });
});

describe("settleRound — loser", () => {
  it("marks the bet LOST with a zero payout, no wallet credit and no WIN_CREDIT row", async () => {
    const userId = await createPlayer();
    await fund(userId, 1_00_000);
    const { betId, roundId } = await placeJodi(userId, ["11", "22", "33"], 1_000);

    await declareResult(roundId, "07");
    const summary = await settleRound(roundId);

    const bet = await Bet.findById(betId).lean();
    expect(bet!.status).toBe("LOST");
    expect(bet!.winningNumber).toBe("07");
    expect(bet!.payoutPaise).toBe(0);
    expect(bet!.settledAt).toBeInstanceOf(Date);

    expect(await available(userId)).toBe(97_000); // unchanged
    expect(await winCreditRows()).toBe(0);
    expect(summary).toMatchObject({ wonCount: 0, lostCount: 1, totalCreditedPaise: 0, totalBets: 1 });
  });
});

describe("settleRound — multiple bets / multiple users", () => {
  it("settles every bet independently and the summary counts and totals reconcile", async () => {
    const [alice, bob] = [await createPlayer(), await createPlayer()];
    await fund(alice, 1_00_000);
    await fund(bob, 5_00_000);

    const aliceWin = await placeJodi(alice, ["07", "22", "48"], 1_000); // wins 1000×90 = 90000
    const roundId = aliceWin.roundId;
    await placeJodi(alice, ["11", "12", "13"], 500); // loses (stake 1500)
    const bobWin = await placeJodi(bob, ["07", "50", "60"], 2_000); // wins 2000×90 = 180000

    await declareResult(roundId, "07");
    const summary = await settleRound(roundId);

    expect(summary).toMatchObject({
      totalBets: 3,
      wonCount: 2,
      lostCount: 1,
      totalStakePaise: 3_000 + 1_500 + 6_000,
      totalCreditedPaise: 90_000 + 180_000,
      processedBets: 3,
    });

    // Alice funded 100000, staked 3000 + 1500, won 90000 on the first bet only.
    expect(await available(alice)).toBe(1_00_000 - 3_000 - 1_500 + 90_000);
    // Bob funded 500000, staked 6000, won 180000.
    expect(await available(bob)).toBe(5_00_000 - 6_000 + 180_000);

    expect(await winCreditRows()).toBe(2);
    expect(await winCreditRows(aliceWin.betId)).toBe(1);
    expect(await winCreditRows(bobWin.betId)).toBe(1);
  });
});

describe("settleRound — payout snapshot is preserved", () => {
  it("uses the bet's stored multiplier, never the current platform rate", async () => {
    const userId = await createPlayer();
    await fund(userId, 1_00_000);
    const { betId, roundId } = await placeJodi(userId, ["07", "22", "48"], 1_000);

    // Platform rate changes AFTER placement — historical bets must ignore it.
    await PlatformSettings.updateOne({ key: "platform" }, { $set: { payoutMultiplier: 50 } });

    await declareResult(roundId, "07");
    await settleRound(roundId);

    const bet = await Bet.findById(betId).lean();
    expect(bet!.payoutMultiplierSnapshot).toBe(90);
    expect(bet!.payoutPaise).toBe(90_000); // 1000 × 90, not 1000 × 50
    expect(await available(userId)).toBe(97_000 + 90_000);
  });
});

describe("settleRound — exact rerun is idempotent", () => {
  it("a second run replays the summary and never duplicates a credit or ledger row", async () => {
    const userId = await createPlayer();
    await fund(userId, 1_00_000);
    const { betId, roundId } = await placeJodi(userId, ["07", "22", "48"], 1_000);
    await declareResult(roundId, "07");

    const first = await settleRound(roundId);
    const balanceAfterFirst = await available(userId);
    const settledAtAfterFirst = (await Bet.findById(betId).lean())!.settledAt;

    const second = await settleRound(roundId);
    const third = await settleRoundBatch(roundId, 100);

    expect(first).toMatchObject({ alreadySettled: false, processedBets: 1, totalCreditedPaise: 90_000 });
    expect(second).toMatchObject({ alreadySettled: true, processedBets: 0, creditedThisRunPaise: 0, totalCreditedPaise: 90_000 });
    expect(third).toMatchObject({ processed: 0, complete: true });

    expect(await available(userId)).toBe(balanceAfterFirst);
    expect(await winCreditRows(betId)).toBe(1);
    expect(await WalletTransaction.countDocuments({ idempotencyKey: winCreditKey(betId) })).toBe(1);
    expect((await Bet.findById(betId).lean())!.settledAt).toEqual(settledAtAfterFirst);
  });
});

describe("settleRound — concurrent attempts", () => {
  it("three racing runs credit the winner exactly once", async () => {
    const userId = await createPlayer();
    await fund(userId, 1_00_000);
    const { betId, roundId } = await placeJodi(userId, ["07", "22", "48"], 1_000);
    await declareResult(roundId, "07");

    const results = await Promise.allSettled([
      settleRound(roundId),
      settleRound(roundId),
      settleRound(roundId),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const summaries = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof settleRound>>>).value);
    // Exactly one invocation actually transitioned the bet.
    expect(summaries.reduce((sum, s) => sum + s.processedBets, 0)).toBe(1);
    for (const s of summaries) {
      expect(s.settlementStatus).toBe("SETTLED");
      expect(s.totalCreditedPaise).toBe(90_000);
    }

    expect(await available(userId)).toBe(97_000 + 90_000);
    expect(await winCreditRows(betId)).toBe(1);
    expect(await Bet.countDocuments({ _id: betId, status: "WON" })).toBe(1);
  });
});

describe("settleRound — no declared result", () => {
  it("rejects and mutates nothing", async () => {
    const userId = await createPlayer();
    await fund(userId, 1_00_000);
    const { betId, roundId } = await placeJodi(userId, ["07", "22", "48"], 1_000);

    await expect(settleRound(roundId)).rejects.toMatchObject({ code: "RESULT_NOT_DECLARED" });
    await expect(settleRoundBatch(roundId, 100)).rejects.toMatchObject({ code: "RESULT_NOT_DECLARED" });

    const bet = await Bet.findById(betId).lean();
    expect(bet!.status).toBe("ACTIVE");
    expect(bet!.payoutPaise ?? null).toBeNull();
    expect(await available(userId)).toBe(97_000);
    expect(await winCreditRows()).toBe(0);
    expect((await MarketRound.findById(roundId).lean())!.settlementStatus).toBe("PENDING");
  });
});

describe("settleRound — wallet conservation and partial-failure recovery", () => {
  it("the increase in total available balances equals the credited total and the WIN_CREDIT sum", async () => {
    const [alice, bob] = [await createPlayer(), await createPlayer()];
    await fund(alice, 1_00_000);
    await fund(bob, 2_00_000);
    const { roundId } = await placeJodi(alice, ["07", "22", "48"], 1_000); // winner
    await placeJodi(bob, ["07", "10", "20"], 1_500); // winner
    await placeJodi(bob, ["31", "32", "33"], 1_000); // loser
    await declareResult(roundId, "07");

    const before = (await available(alice)) + (await available(bob));
    const summary = await settleRound(roundId);
    const after = (await available(alice)) + (await available(bob));

    const winCreditSum = (
      await WalletTransaction.aggregate<{ total: number }>([
        { $match: { type: "WIN_CREDIT" } },
        { $group: { _id: null, total: { $sum: "$amountPaise" } } },
      ])
    )[0]?.total ?? 0;

    expect(after - before).toBe(summary.totalCreditedPaise);
    expect(winCreditSum).toBe(summary.totalCreditedPaise);
    expect(await winCreditRows()).toBe(summary.wonCount);
  });

  it("a mid-round credit failure leaves the round PROCESSING and rerun-recoverable with no duplicate credit", async () => {
    const userId = await createPlayer();
    await fund(userId, 1_00_000);
    const { betId, roundId } = await placeJodi(userId, ["07", "22", "48"], 1_000);
    await declareResult(roundId, "07");

    // Force the winning credit to fail: remove the wallet the credit needs.
    await Wallet.deleteMany({ userId });
    await expect(settleRound(roundId)).rejects.toMatchObject({ code: "WALLET_NOT_FOUND" });

    expect((await Bet.findById(betId).lean())!.status).toBe("ACTIVE");
    expect(await winCreditRows(betId)).toBe(0);
    expect((await MarketRound.findById(roundId).lean())!.settlementStatus).toBe("PROCESSING");

    // Recover the wallet, then re-run: it finishes cleanly and credits exactly once.
    await fund(userId, 100);
    const summary = await settleRound(roundId);

    expect(summary).toMatchObject({ processedBets: 1, wonCount: 1, totalCreditedPaise: 90_000 });
    expect((await Bet.findById(betId).lean())!.status).toBe("WON");
    expect(await winCreditRows(betId)).toBe(1);
    expect(await available(userId)).toBe(100 + 90_000);
    expect((await MarketRound.findById(roundId).lean())!.settlementStatus).toBe("SETTLED");
  });
});
