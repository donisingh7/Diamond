import "server-only";
import type { Types } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import { safeAdd, safeMultiply } from "@/lib/money";
import { Bet } from "@/modules/betting/models/bet.model";
import { MarketRound, type MarketRoundRecord } from "@/modules/markets/models/market-round.model";
import { creditAvailableInSession } from "@/modules/wallet/services/wallet.service";
import type { SettlementService } from "./settlement.contract";

/**
 * Settlement core (Window 7A1) — turns ONE declared, unsettled `MarketRound` into final bet
 * outcomes and winning wallet credits. Backend domain only: no HTTP route, no admin UI, no
 * cross-round orchestration (Window 7A2).
 *
 * Guarantees:
 *  - **Result-gated.** No declared `round.result` → `RESULT_NOT_DECLARED`, nothing mutates.
 *  - **Snapshot-faithful.** A winning credit is `matchingSelection.stakePaise ×
 *    bet.payoutMultiplierSnapshot` — the rate frozen onto the bet at placement, NEVER the
 *    current `platformSettings.payoutMultiplier`. The original stake is not added back.
 *  - **Per-bet atomicity.** Each bet is settled in its OWN Mongo transaction: the
 *    `ACTIVE → WON/LOST` transition and, for a winner, the single immutable `WIN_CREDIT`
 *    ledger + available-balance credit commit or roll back together. A mid-round failure
 *    leaves earlier bets settled and the rest `ACTIVE` for a resumed run.
 *  - **Idempotent.** The bet transition is a CAS on `status: "ACTIVE"`; a rerun finds the bet
 *    already `WON`/`LOST` and skips it. The `WIN_CREDIT:<betId>` idempotency key is unique in
 *    `walletTransactions`, so a credit can physically happen at most once per bet.
 *  - **Concurrency-safe.** Two settlement runs racing the same bet: one wins the CAS, the
 *    other hits a write conflict, retries under a fresh snapshot, sees the settled status and
 *    skips. No double credit, no double ledger row.
 *  - **Safe finalisation.** The round is marked `SETTLED` (with `settledAt` + summary) only
 *    once no `ACTIVE` bet remains, via a CAS from `PROCESSING`. A round already `SETTLED`
 *    replays its stored summary without touching money.
 */

/** Deterministic, globally-unique idempotency key for a bet's winning credit. */
export function winCreditKey(betId: Types.ObjectId): string {
  return `WIN_CREDIT:${betId.toHexString()}`;
}

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
/** Hard stop for the drain loop — far above any realistic round bet count. */
const MAX_BATCHES = 100_000;

function clampBatchSize(batchSize: number): number {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(batchSize, MAX_BATCH_SIZE);
}

type SettleOneOutcome = "WON" | "LOST" | "ALREADY_SETTLED";

/** The lean bet fields settlement needs. */
type SettleableBet = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  marketId: Types.ObjectId;
  selections: { number: string; stakePaise: number }[];
  payoutMultiplierSnapshot: number;
};

/**
 * Settle exactly one bet against `result` in its own transaction. The `updateOne` filter pins
 * `status: "ACTIVE"`, so a bet already carried to a terminal status by a prior run or a
 * concurrent worker yields `matchedCount === 0` and this returns `ALREADY_SETTLED` with no
 * wallet movement.
 */
async function settleOneBet(bet: SettleableBet, result: string): Promise<{ outcome: SettleOneOutcome; creditedPaise: number }> {
  const match = bet.selections.find((selection) => selection.number === result);
  const won = match != null;
  // Only the matching selection's stake is paid, at the bet's OWN snapshot rate.
  const payoutPaise = won ? safeMultiply(match!.stakePaise, bet.payoutMultiplierSnapshot) : 0;

  return withTransaction(async (session) => {
    const now = new Date();
    const res = await Bet.updateOne(
      { _id: bet._id, status: "ACTIVE" },
      {
        $set: {
          status: won ? "WON" : "LOST",
          // Denormalised onto the bet so its history renders an outcome without joining the
          // round; for a LOST bet this is still the round's winning number.
          winningNumber: result,
          payoutPaise,
          settledAt: now,
        },
      },
      { session, runValidators: true },
    );
    if (res.matchedCount !== 1) {
      return { outcome: "ALREADY_SETTLED" as const, creditedPaise: 0 };
    }

    if (won) {
      await creditAvailableInSession(
        {
          userId: bet.userId,
          type: "WIN_CREDIT",
          amountPaise: payoutPaise,
          idempotencyKey: winCreditKey(bet._id),
          referenceType: "BET",
          referenceId: bet._id,
        },
        session,
      );
    }
    return { outcome: won ? ("WON" as const) : ("LOST" as const), creditedPaise: won ? payoutPaise : 0 };
  });
}

export type SettleBatchResult = {
  /** Bets this call carried `ACTIVE → WON/LOST` (excludes ones already settled by another run). */
  processed: number;
  wonCount: number;
  lostCount: number;
  creditedPaise: number;
  /** `true` when no `ACTIVE` bet remains for the round. */
  complete: boolean;
};

/**
 * Process up to `batchSize` still-`ACTIVE` bets for a declared round, oldest first, one
 * transaction each. Resumable: call again until `complete`. Requires a declared result but does
 * NOT touch `round.settlementStatus` — `settleRound` owns that lifecycle.
 */
export async function settleRoundBatch(roundId: Types.ObjectId, batchSize: number): Promise<SettleBatchResult> {
  const round = await MarketRound.findById(roundId).lean<
    (MarketRoundRecord & { _id: Types.ObjectId }) | null
  >();
  if (!round) throw new DomainError("ROUND_NOT_FOUND", "Round not found.");
  if (round.result == null) {
    throw new DomainError("RESULT_NOT_DECLARED", "This round has no declared result to settle against.");
  }

  const size = clampBatchSize(batchSize);
  const active = await Bet.find({ marketRoundId: roundId, status: "ACTIVE" })
    .sort({ _id: 1 })
    .limit(size)
    .select({ _id: 1, userId: 1, marketId: 1, selections: 1, payoutMultiplierSnapshot: 1 })
    .lean<SettleableBet[]>();

  let processed = 0;
  let wonCount = 0;
  let lostCount = 0;
  let creditedPaise = 0;
  for (const bet of active) {
    const { outcome, creditedPaise: credited } = await settleOneBet(bet, round.result);
    if (outcome === "ALREADY_SETTLED") continue;
    processed += 1;
    if (outcome === "WON") {
      wonCount += 1;
      creditedPaise = safeAdd(creditedPaise, credited);
    } else {
      lostCount += 1;
    }
  }

  const remaining = await Bet.countDocuments({ marketRoundId: roundId, status: "ACTIVE" });
  return { processed, wonCount, lostCount, creditedPaise, complete: remaining === 0 };
}

export type RoundSettlementSummary = {
  roundId: string;
  marketId: string;
  businessDate: string;
  result: string;
  settlementStatus: "SETTLED";
  settledAt: string;
  /** `true` when this call found the round already fully settled and replayed its summary
   *  instead of transitioning any bet. */
  alreadySettled: boolean;
  /** Bets THIS invocation carried `ACTIVE → WON/LOST` (0 on a pure replay). */
  processedBets: number;
  /** Winning credits THIS invocation applied, in paise (0 on a pure replay). */
  creditedThisRunPaise: number;
  totalBets: number;
  wonCount: number;
  lostCount: number;
  totalStakePaise: number;
  /** Total winning paise credited across the whole round — deterministic, recomputed from the
   *  persisted bet outcomes, so it is identical on the first run and every replay. */
  totalCreditedPaise: number;
};

/** Recompute the round-wide summary from persisted bet outcomes — deterministic across replays. */
async function computeRoundSummary(roundId: Types.ObjectId): Promise<{
  totalBets: number;
  wonCount: number;
  lostCount: number;
  totalStakePaise: number;
  totalCreditedPaise: number;
}> {
  const bets = await Bet.find({ marketRoundId: roundId })
    .select({ status: 1, totalStakePaise: 1, payoutPaise: 1 })
    .lean<{ status: string; totalStakePaise: number; payoutPaise?: number }[]>();

  let wonCount = 0;
  let lostCount = 0;
  let totalStakePaise = 0;
  let totalCreditedPaise = 0;
  for (const bet of bets) {
    totalStakePaise = safeAdd(totalStakePaise, bet.totalStakePaise);
    if (bet.status === "WON") {
      wonCount += 1;
      totalCreditedPaise = safeAdd(totalCreditedPaise, bet.payoutPaise ?? 0);
    } else if (bet.status === "LOST") {
      lostCount += 1;
    }
  }
  return { totalBets: bets.length, wonCount, lostCount, totalStakePaise, totalCreditedPaise };
}

function summaryFromRound(
  round: MarketRoundRecord & { _id: Types.ObjectId },
  extras: { alreadySettled: boolean; processedBets: number; creditedThisRunPaise: number },
): RoundSettlementSummary {
  const persisted = round.settlementSummary;
  return {
    roundId: round._id.toString(),
    marketId: round.marketId.toString(),
    businessDate: round.businessDate,
    result: round.result!,
    settlementStatus: "SETTLED",
    settledAt: (round.settledAt ?? new Date()).toISOString(),
    alreadySettled: extras.alreadySettled,
    processedBets: extras.processedBets,
    creditedThisRunPaise: extras.creditedThisRunPaise,
    totalBets: persisted?.totalBets ?? 0,
    wonCount: persisted?.winningBets ?? 0,
    lostCount: persisted?.losingBets ?? 0,
    totalStakePaise: persisted?.totalStakePaise ?? 0,
    totalCreditedPaise: persisted?.totalPayoutPaise ?? 0,
  };
}

/**
 * Settle one declared, unsettled `MarketRound` to completion and return a summary.
 *
 * Lifecycle: `PENDING`/`FAILED` → CAS to `PROCESSING` → drain every `ACTIVE` bet in per-bet
 * transactions → CAS `PROCESSING → SETTLED` with `settledAt` + a recomputed summary. Safe to
 * re-run after any partial failure and safe to run concurrently: bet-level CAS + the unique
 * `WIN_CREDIT` key make double credits impossible, and whichever run performs the final CAS
 * writes the summary the others then replay (`alreadySettled: true`).
 */
export async function settleRound(
  roundId: Types.ObjectId,
  options: { batchSize?: number } = {},
): Promise<RoundSettlementSummary> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  const initial = await MarketRound.findById(roundId).lean<
    (MarketRoundRecord & { _id: Types.ObjectId }) | null
  >();
  if (!initial) throw new DomainError("ROUND_NOT_FOUND", "Round not found.");
  if (initial.result == null) {
    throw new DomainError("RESULT_NOT_DECLARED", "This round has no declared result to settle against.");
  }
  if (initial.settlementStatus === "SETTLED") {
    return summaryFromRound(initial, { alreadySettled: true, processedBets: 0, creditedThisRunPaise: 0 });
  }

  // Claim the round for processing. A no-op `$set` when it is already PROCESSING, so concurrent
  // callers both pass here — the per-bet guards, not this marker, are what prevent double credit.
  const claim = await MarketRound.updateOne(
    { _id: roundId, result: { $exists: true }, settlementStatus: { $in: ["PENDING", "PROCESSING", "FAILED"] } },
    { $set: { settlementStatus: "PROCESSING" } },
    { runValidators: true },
  );
  if (claim.matchedCount !== 1) {
    const now = await MarketRound.findById(roundId).lean<
      (MarketRoundRecord & { _id: Types.ObjectId }) | null
    >();
    if (now?.settlementStatus === "SETTLED") {
      return summaryFromRound(now, { alreadySettled: true, processedBets: 0, creditedThisRunPaise: 0 });
    }
    throw new DomainError("INTERNAL_ERROR", "Round could not be claimed for settlement.");
  }

  let processedBets = 0;
  let creditedThisRunPaise = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const result = await settleRoundBatch(roundId, batchSize);
    processedBets += result.processed;
    creditedThisRunPaise = safeAdd(creditedThisRunPaise, result.creditedPaise);
    if (result.complete) break;
    if (result.processed === 0) {
      // No progress but bets still ACTIVE — cannot happen (no bet is placeable after a result
      // exists, and an unsettleable bet would have thrown). Fail loudly rather than spin.
      throw new DomainError("INTERNAL_ERROR", "Settlement stalled with active bets remaining.");
    }
  }

  const summary = await computeRoundSummary(roundId);
  const now = new Date();
  const finalise = await MarketRound.updateOne(
    { _id: roundId, settlementStatus: "PROCESSING" },
    {
      $set: {
        settlementStatus: "SETTLED",
        settledAt: now,
        settlementSummary: {
          totalBets: summary.totalBets,
          winningBets: summary.wonCount,
          losingBets: summary.lostCount,
          totalStakePaise: summary.totalStakePaise,
          totalPayoutPaise: summary.totalCreditedPaise,
        },
      },
    },
    { runValidators: true },
  );

  const settled = await MarketRound.findById(roundId).lean<
    (MarketRoundRecord & { _id: Types.ObjectId }) | null
  >();
  if (!settled || settled.settlementStatus !== "SETTLED") {
    throw new DomainError("INTERNAL_ERROR", "Round settlement could not be finalised.");
  }
  // `matchedCount === 0` here means a concurrent run finalised first — replay its summary.
  return summaryFromRound(settled, {
    alreadySettled: finalise.matchedCount !== 1,
    processedBets,
    creditedThisRunPaise,
  });
}

/** Contract binding (Window 7): a resumable per-batch settlement primitive. */
export const settlementService: SettlementService = {
  settleBatch: (roundId, batchSize) =>
    settleRoundBatch(roundId, batchSize).then(({ processed, complete }) => ({ processed, complete })),
};
