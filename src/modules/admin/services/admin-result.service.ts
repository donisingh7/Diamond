import "server-only";
import { Types } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import { isDuplicateKeyError } from "@/modules/wallet/services/wallet.service";
import { writeAuditLog } from "@/modules/audit/services/audit-log.service";
import { MarketRound, type MarketRoundRecord } from "@/modules/markets/models/market-round.model";
import { ensureMarketRound, resolveCurrentRound, type MarketRoundDoc } from "@/modules/markets/services/market.service";
import { resolveMarket } from "./admin-market.service";

/**
 * Admin result declaration (Window 6A2) — a deliberate TWO-STEP backend contract:
 *
 *   1. `prepareResultDeclaration` — validates admin / market / round / closed-state / result
 *      syntax and returns a sanitized preview. NO mutation. It carries an explicit warning that
 *      settlement has NOT occurred.
 *   2. `confirmResultDeclaration` — requires an explicit confirmation flag + a client UUID, then
 *      atomically writes the canonical `marketRounds.result` + declaration metadata + a
 *      `RESULT_DECLARED` audit row.
 *
 * This window NEVER settles: no `Bet` WON/LOST transition, no `WIN_CREDIT`, no wallet winnings,
 * no settlement summary. `settlementStatus` stays `PENDING`. Settlement is Window 7A.
 *
 * The result is a two-character STRING `"00".."99"` — leading zeros preserved, no numeric
 * coercion. Declaration is allowed only when `now >= round.closesAt` (exactly at close is
 * allowed; strictly before is `RESULT_TOO_EARLY`). Server time only — no client timestamp.
 * A round that already carries a result is `RESULT_ALREADY_DECLARED` (there is no unrestricted
 * correction endpoint); an exact replay of the same `(round, clientRequestId, result)` returns
 * the original declaration.
 */

const RESULT_WARNING =
  "Declaring a result records the winning number only. It does NOT settle bets: no bet status "
  + "changes, no WIN_CREDIT and no wallet movement happen here. Settlement is a later step (Window 7A).";

// --- shared round resolution ------------------------------------------------------

type ResolvedDeclarationRound = {
  market: Awaited<ReturnType<typeof resolveMarket>>;
  round: MarketRoundDoc;
};

async function resolveDeclarationRound(
  marketId: string,
  businessDate: string | undefined,
  now: Date,
): Promise<ResolvedDeclarationRound> {
  const market = await resolveMarket(marketId);
  if (businessDate) {
    return { market, round: await ensureMarketRound(market, businessDate) };
  }
  const resolved = await resolveCurrentRound(market, now);
  if (!resolved.round) {
    throw new DomainError("ROUND_NOT_FOUND", "This market has no current round — pass an explicit businessDate.");
  }
  return { market, round: resolved.round };
}

/** Enforce the close-time rule with server time only. */
function assertClosed(round: Pick<MarketRoundRecord, "closesAt">, now: Date): void {
  if (now < round.closesAt) {
    throw new DomainError("RESULT_TOO_EARLY", "A result cannot be declared before the market closes.");
  }
}

// --- DTOs -----------------------------------------------------------------------

export type ResultDeclarationPreview = {
  market: { id: string; name: string; slug: string; code: string };
  businessDate: string;
  closesAt: string;
  proposedResult: string;
  currentResult: string | null;
  alreadyDeclared: boolean;
  settlementStatus: string;
  /** Always `false` here — a preview never mutates and settlement is not this window. */
  settlementPerformed: false;
  warning: string;
  serverNow: string;
};

export type DeclaredResult = {
  market: { id: string; name: string; slug: string; code: string };
  businessDate: string;
  result: string;
  resultDeclaredAt: string;
  declaredByAdminId: string;
  closesAt: string;
  settlementStatus: string;
  /** Always `false` — this window declares only; Window 7A settles. */
  settlementPerformed: false;
  idempotentReplay: boolean;
  serverNow: string;
};

function marketRef(market: Awaited<ReturnType<typeof resolveMarket>>) {
  return { id: market._id.toString(), name: market.name, slug: market.slug, code: market.code };
}

function toDeclaredResult(
  market: Awaited<ReturnType<typeof resolveMarket>>,
  round: Pick<MarketRoundRecord, "businessDate" | "result" | "resultDeclaredAt" | "declaredByAdminId" | "closesAt" | "settlementStatus">,
  idempotentReplay: boolean,
  now: Date,
): DeclaredResult {
  return {
    market: marketRef(market),
    businessDate: round.businessDate,
    result: round.result!,
    resultDeclaredAt: round.resultDeclaredAt!.toISOString(),
    declaredByAdminId: round.declaredByAdminId!.toString(),
    closesAt: round.closesAt.toISOString(),
    settlementStatus: round.settlementStatus,
    settlementPerformed: false,
    idempotentReplay,
    serverNow: now.toISOString(),
  };
}

// --- step 1: prepare / preview -------------------------------------------------

export type PrepareResultInput = { marketId: string; businessDate?: string; result: string };

export async function prepareResultDeclaration(
  input: PrepareResultInput,
  now: Date = new Date(),
): Promise<ResultDeclarationPreview> {
  const { market, round } = await resolveDeclarationRound(input.marketId, input.businessDate, now);
  assertClosed(round, now);
  return {
    market: marketRef(market),
    businessDate: round.businessDate,
    closesAt: round.closesAt.toISOString(),
    proposedResult: input.result,
    currentResult: round.result ?? null,
    alreadyDeclared: round.result != null,
    settlementStatus: round.settlementStatus,
    settlementPerformed: false,
    warning: RESULT_WARNING,
    serverNow: now.toISOString(),
  };
}

// --- step 2: confirm / declare ----------------------------------------------

export type ConfirmResultInput = {
  actorAdminId: Types.ObjectId;
  marketId: string;
  businessDate?: string;
  result: string;
  clientRequestId: string;
};

async function recoverDeclaration(
  roundId: Types.ObjectId,
  input: ConfirmResultInput,
  market: Awaited<ReturnType<typeof resolveMarket>>,
  now: Date,
): Promise<DeclaredResult | null> {
  const prior = await MarketRound.findOne({ resultDeclaredRequestId: input.clientRequestId }).lean<
    MarketRoundRecord & { _id: Types.ObjectId }
  >();
  if (!prior) return null;
  if (
    !prior._id.equals(roundId)
    || prior.result !== input.result
    || !prior.declaredByAdminId?.equals(input.actorAdminId)
  ) {
    throw new DomainError("DUPLICATE_REQUEST", "This request id was already used for a different result declaration.");
  }
  return toDeclaredResult(market, prior, true, now);
}

export async function confirmResultDeclaration(
  input: ConfirmResultInput,
  now: Date = new Date(),
): Promise<DeclaredResult> {
  const { market, round } = await resolveDeclarationRound(input.marketId, input.businessDate, now);
  assertClosed(round, now);
  const roundId = round._id;

  const replay = await recoverDeclaration(roundId, input, market, now);
  if (replay) return replay;

  if (round.result != null) {
    throw new DomainError("RESULT_ALREADY_DECLARED", "This round already has a declared result.");
  }

  try {
    await withTransaction(async (session) => {
      const declaredAt = now;
      const res = await MarketRound.updateOne(
        { _id: roundId, result: { $exists: false } },
        {
          $set: {
            result: input.result,
            resultDeclaredAt: declaredAt,
            declaredByAdminId: input.actorAdminId,
            resultDeclaredRequestId: input.clientRequestId,
          },
        },
        { session, runValidators: true },
      );
      if (res.matchedCount !== 1) {
        throw new DomainError("RESULT_ALREADY_DECLARED", "This round already has a declared result.");
      }
      await writeAuditLog(
        {
          actorAdminId: input.actorAdminId,
          action: "RESULT_DECLARED",
          entityType: "MarketRound",
          entityId: roundId,
          after: {
            marketId: market._id.toString(),
            slug: market.slug,
            businessDate: round.businessDate,
            result: input.result,
            closesAt: round.closesAt.toISOString(),
            // Explicit: settlement did NOT run in this window.
            settlementPerformed: false,
          },
        },
        session,
      );
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === "RESULT_ALREADY_DECLARED") {
      const raced = await recoverDeclaration(roundId, input, market, now);
      if (raced) return raced;
      throw error;
    }
    if (isDuplicateKeyError(error)) {
      const raced = await recoverDeclaration(roundId, input, market, now);
      if (raced) return raced;
      throw new DomainError("DUPLICATE_REQUEST", "This request id was already used for a different result declaration.");
    }
    throw error;
  }

  const fresh = await MarketRound.findById(roundId).lean<MarketRoundRecord & { _id: Types.ObjectId }>();
  if (!fresh || fresh.result == null) {
    throw new DomainError("INTERNAL_ERROR", "Result declaration could not be confirmed.");
  }
  return toDeclaredResult(market, fresh, false, now);
}
