import "server-only";
import type { Types } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { writeAuditLog } from "@/modules/audit/services/audit-log.service";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import { resolveCurrentRound } from "@/modules/markets/services/market.service";
import { settleRound, type RoundSettlementSummary } from "@/modules/settlement/services/settlement.service";
import { resolveMarket } from "./admin-market.service";

/**
 * Admin settlement orchestration (Window 7A2) — the minimal admin-facing trigger over the
 * Window 7A1 `settleRound()` engine. It resolves the admin's market + round and hands off; it
 * does NOT re-implement settlement, move any wallet itself, or read / modify `round.result`.
 * Settlement runs against whatever result Window 6A2 declared and there is no path here to
 * change it (the route body has no `result` field).
 *
 * Idempotent by construction: `settleRound()` replays a finished round's stored summary
 * (`alreadySettled: true`) with no money movement and per-bet CAS + the unique `WIN_CREDIT`
 * key make a double credit impossible under replay or concurrency. This wrapper writes the one
 * `ROUND_SETTLED` audit row ONLY on the call that performed the real `PROCESSING → SETTLED`
 * transition — a replay or a lost concurrency race adds no row, so the trail never shows a
 * second, misleading "settled" financial event for a single round.
 */

export type AdminSettleRoundInput = {
  actorAdminId: Types.ObjectId;
  marketId: string;
  /** `YYYY-MM-DD`. Omitted → the market's current round (must already exist). */
  businessDate?: string;
};

export type AdminRoundSettlement = RoundSettlementSummary & {
  market: { id: string; name: string; slug: string; code: string };
  /** `true` when THIS call wrote the `ROUND_SETTLED` audit row (it performed the transition);
   *  `false` on a harmless replay / already-settled round. */
  auditWritten: boolean;
};

/** Resolve the target round id WITHOUT ever creating one — an unknown round is a hard error. */
async function resolveRoundId(
  market: Awaited<ReturnType<typeof resolveMarket>>,
  businessDate: string | undefined,
  now: Date,
): Promise<Types.ObjectId> {
  if (businessDate) {
    const round = await MarketRound.findOne({ marketId: market._id, businessDate })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId } | null>();
    if (!round) {
      throw new DomainError("ROUND_NOT_FOUND", "No round exists for this market and business date.");
    }
    return round._id;
  }
  const resolved = await resolveCurrentRound(market, now);
  if (!resolved.round) {
    throw new DomainError("ROUND_NOT_FOUND", "This market has no current round — pass an explicit businessDate.");
  }
  return resolved.round._id;
}

export async function settleDeclaredRound(
  input: AdminSettleRoundInput,
  now: Date = new Date(),
): Promise<AdminRoundSettlement> {
  const market = await resolveMarket(input.marketId);
  const roundId = await resolveRoundId(market, input.businessDate, now);

  // `settleRound` itself throws ROUND_NOT_FOUND / RESULT_NOT_DECLARED and moves no bet without
  // a declared result. It owns the full lifecycle + idempotency guarantees.
  const summary = await settleRound(roundId);

  if (!summary.alreadySettled) {
    await writeAuditLog({
      actorAdminId: input.actorAdminId,
      action: "ROUND_SETTLED",
      entityType: "MarketRound",
      entityId: roundId,
      after: {
        marketId: market._id.toString(),
        slug: market.slug,
        businessDate: summary.businessDate,
        result: summary.result,
        settlementStatus: summary.settlementStatus,
        settledAt: summary.settledAt,
        totalBets: summary.totalBets,
        wonCount: summary.wonCount,
        lostCount: summary.lostCount,
        totalStakePaise: summary.totalStakePaise,
        totalCreditedPaise: summary.totalCreditedPaise,
        processedBets: summary.processedBets,
        creditedThisRunPaise: summary.creditedThisRunPaise,
      },
    });
  }

  return {
    ...summary,
    market: { id: market._id.toString(), name: market.name, slug: market.slug, code: market.code },
    auditWritten: !summary.alreadySettled,
  };
}
