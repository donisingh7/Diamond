import "server-only";
import { DateTime } from "luxon";
import { deriveMarketStatus, type MarketLifecycleState } from "@/lib/dates/market-time";
import { Market } from "../models/market.model";
import { MarketRound } from "../models/market-round.model";
import type { ResultHistoryRange } from "../validators/market-query";
import {
  getMarketBySlug,
  listMarkets,
  resolveCurrentRoundsForMarkets,
  type MarketDoc,
} from "./market.service";

/** All current markets share this; history date boundaries are evaluated here, never in browser locale. */
const PLATFORM_TIMEZONE = "Asia/Kolkata";
const RANGE_DAYS: Record<ResultHistoryRange, number> = { "7d": 7, "30d": 30 };

/** One market's result as *read* (never declared) by this window. No admin identifiers exposed. */
export type ResultEntry = {
  marketId: string;
  name: string;
  slug: string;
  code: string;
  displayOrder: number;
  businessDate: string;
  state: MarketLifecycleState;
  result: string | null;
  resultDeclaredAt: string | null;
  settlementStatus: string;
  opensAt: string | null;
  closesAt: string | null;
};

type RoundLike = {
  businessDate: string;
  opensAt: Date;
  editCutoffAt: Date;
  closesAt: Date;
  result?: string | null;
  resultDeclaredAt?: Date | null;
  settlementStatus: "PENDING" | "PROCESSING" | "SETTLED" | "FAILED";
};

function entryFromRound(market: MarketDoc, round: RoundLike, now: Date): ResultEntry {
  return {
    marketId: market._id.toString(),
    name: market.name,
    slug: market.slug,
    code: market.code,
    displayOrder: market.displayOrder,
    businessDate: round.businessDate,
    state: deriveMarketStatus(
      market.enabled,
      {
        opensAt: round.opensAt,
        editCutoffAt: round.editCutoffAt,
        closesAt: round.closesAt,
        result: round.result ?? null,
        settlementStatus: round.settlementStatus,
      },
      now,
    ),
    result: round.result ?? null,
    resultDeclaredAt: round.resultDeclaredAt?.toISOString() ?? null,
    settlementStatus: round.settlementStatus,
    opensAt: round.opensAt.toISOString(),
    closesAt: round.closesAt.toISOString(),
  };
}

function disabledEntry(market: MarketDoc, businessDate: string): ResultEntry {
  return {
    marketId: market._id.toString(),
    name: market.name,
    slug: market.slug,
    code: market.code,
    displayOrder: market.displayOrder,
    businessDate,
    state: "DISABLED",
    result: null,
    resultDeclaredAt: null,
    settlementStatus: "PENDING",
    opensAt: null,
    closesAt: null,
  };
}

/**
 * Inclusive IST calendar window ending on `now`'s business day.
 * 7d = today plus the preceding 6 days; 30d = today plus the preceding 29.
 */
export function historyWindow(range: ResultHistoryRange, now: Date): { startDate: string; endDate: string } {
  const today = DateTime.fromJSDate(now, { zone: PLATFORM_TIMEZONE });
  if (!today.isValid) throw new Error("Invalid server time.");
  return {
    startDate: today.minus({ days: RANGE_DAYS[range] - 1 }).toISODate()!,
    endDate: today.toISODate()!,
  };
}

/**
 * `range=today`: every market's currently-relevant operational round (see resolveCurrentRound).
 * For a cross-midnight market between 00:00 and its close this is still the previous calendar
 * business date; after that round closes and before the next opens it is the upcoming round with
 * no result yet. Deterministic, and documented so the later UI doesn't have to guess.
 */
export async function getCurrentResults(now: Date): Promise<ResultEntry[]> {
  const markets = await listMarkets();
  const resolved = await resolveCurrentRoundsForMarkets(markets, now);
  return markets.map((market) => {
    const current = resolved.get(market._id.toString())!;
    if (!current.round) return disabledEntry(market, current.businessDate);
    return entryFromRound(market, current.round, now);
  });
}

/**
 * Persisted result-bearing rounds only — this never manufactures empty history rows. Bounded to the
 * requested IST window and capped at today so a future-dated round cannot leak in. Newest business
 * date first, then market display order.
 */
export async function getResultHistory(
  range: ResultHistoryRange,
  now: Date,
  marketSlug?: string,
): Promise<ResultEntry[]> {
  const { startDate, endDate } = historyWindow(range, now);
  const marketFilter = marketSlug ? { marketId: (await getMarketBySlug(marketSlug))._id } : {};

  // `result` is only ever persisted once declared (the two-digit setter rejects null), so
  // `$exists` is the result-bearing filter — `$ne: null` would run the setter on null and throw.
  const rounds = await MarketRound.find({
    ...marketFilter,
    businessDate: { $gte: startDate, $lte: endDate },
    result: { $exists: true },
  })
    .sort({ businessDate: -1 })
    .exec();

  const markets = new Map((await Market.find()).map((market) => [market._id.toString(), market]));
  return rounds
    .flatMap((round) => {
      const market = markets.get(round.marketId.toString());
      return market ? [entryFromRound(market, round, now)] : [];
    })
    .sort((a, b) =>
      a.businessDate === b.businessDate
        ? a.displayOrder - b.displayOrder
        : a.businessDate < b.businessDate
          ? 1
          : -1,
    );
}
