import "server-only";
import type { HydratedDocument } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import {
  deriveMarketStatus,
  getBettingWindow,
  getRoundTimes,
  resolveMarketBusinessDate,
  type BettingWindow,
  type MarketLifecycleState,
  type MarketSchedule,
  type RoundState,
} from "@/lib/dates/market-time";
import { Market, type MarketRecord } from "../models/market.model";
import { MarketRound, type MarketRoundRecord } from "../models/market-round.model";
import { marketSlugSchema } from "../validators/market-query";

export type MarketDoc = HydratedDocument<MarketRecord>;
export type MarketRoundDoc = HydratedDocument<MarketRoundRecord>;

/** What round a market is operating on right now, plus its server-authoritative availability. */
export type ResolvedRound = {
  businessDate: string;
  round: MarketRoundDoc | null;
  state: MarketLifecycleState;
  bettingWindow: BettingWindow;
};

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

/** The subset of a market row that drives every time calculation; nothing else may. */
export function marketScheduleOf(market: MarketDoc): MarketSchedule {
  return {
    timezone: market.timezone,
    openTimeMinutes: market.openTimeMinutes,
    closeTimeMinutes: market.closeTimeMinutes,
    closeDayOffset: market.closeDayOffset,
    editLockMinutesBeforeClose: market.editLockMinutesBeforeClose,
  };
}

export function roundStateOf(round: MarketRoundDoc): RoundState {
  return {
    opensAt: round.opensAt,
    editCutoffAt: round.editCutoffAt,
    closesAt: round.closesAt,
    result: round.result ?? null,
    settlementStatus: round.settlementStatus,
  };
}

export function listMarkets(): Promise<MarketDoc[]> {
  return Market.find().sort({ displayOrder: 1, _id: 1 }).exec();
}

export function listEnabledMarkets(): Promise<MarketDoc[]> {
  return Market.find({ enabled: true }).sort({ displayOrder: 1, _id: 1 }).exec();
}

export async function getMarketBySlug(slug: string): Promise<MarketDoc> {
  const normalized = marketSlugSchema.parse(slug);
  const market = await Market.findOne({ slug: normalized });
  if (!market) throw new DomainError("MARKET_NOT_FOUND", "Market not found.");
  return market;
}

/** The market's operating business date for `now` — cross-midnight aware via the Window 1 resolver. */
export function currentBusinessDate(market: MarketDoc, now: Date): string {
  return resolveMarketBusinessDate(marketScheduleOf(market), now);
}

/**
 * Idempotent create-or-get for one (market, businessDate) round. Timestamps are snapshotted from the
 * market's *current* schedule at creation and never recomputed afterwards, so a later admin schedule
 * edit cannot mutate historical rounds. The unique (marketId, businessDate) index is the concurrency
 * backstop: a lost create race throws E11000 and we re-read the winner instead of inserting a duplicate.
 */
export async function ensureMarketRound(market: MarketDoc, businessDate: string): Promise<MarketRoundDoc> {
  const existing = await MarketRound.findOne({ marketId: market._id, businessDate });
  if (existing) return existing;

  const times = getRoundTimes(marketScheduleOf(market), businessDate);
  try {
    return await MarketRound.create({
      marketId: market._id,
      businessDate,
      opensAt: times.opensAt,
      editCutoffAt: times.editCutoffAt,
      closesAt: times.closesAt,
      settlementStatus: "PENDING",
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const raced = await MarketRound.findOne({ marketId: market._id, businessDate });
      if (raced) return raced;
    }
    throw error;
  }
}

/**
 * Canonical "current round" resolution. Return semantics (documented so callers never guess):
 *  - before open        → today's round, state UPCOMING
 *  - during hours        → today's round, state OPEN / CLOSING_SOON
 *  - after same-day close → today's round, state RESULT_PENDING (until a result exists)
 *  - Disawar 00:00–03:00 → *previous* calendar date's round, still OPEN/CLOSING_SOON
 *  - Disawar 03:00–07:00 → the new date's round, state UPCOMING (the closed round stays queryable
 *                          for results via the result service, it just isn't "current")
 * A disabled market resolves to `round: null` + DISABLED and no round is persisted for it.
 */
export async function resolveCurrentRound(market: MarketDoc, now: Date): Promise<ResolvedRound> {
  const businessDate = currentBusinessDate(market, now);
  if (!market.enabled) {
    return { businessDate, round: null, state: "DISABLED", bettingWindow: getBettingWindow(false, null, now) };
  }
  const round = await ensureMarketRound(market, businessDate);
  const roundState = roundStateOf(round);
  return {
    businessDate: round.businessDate,
    round,
    state: deriveMarketStatus(true, roundState, now),
    bettingWindow: getBettingWindow(true, roundState, now),
  };
}

/**
 * Batched form of resolveCurrentRound for the market listing: one `$or` read over the unique index
 * instead of one findOne per market, then a targeted insert only for dates not yet persisted
 * (typically 6 inserts on the day's first request, 0 for the rest of the day). Keyed by market id string.
 */
export async function resolveCurrentRoundsForMarkets(
  markets: MarketDoc[],
  now: Date,
): Promise<Map<string, ResolvedRound>> {
  const enabled = markets.filter((market) => market.enabled);
  const wanted = enabled.map((market) => ({
    market,
    businessDate: currentBusinessDate(market, now),
  }));

  const found = wanted.length
    ? await MarketRound.find({
        $or: wanted.map(({ market, businessDate }) => ({ marketId: market._id, businessDate })),
      })
    : [];
  const byKey = new Map(found.map((round) => [`${round.marketId.toString()}:${round.businessDate}`, round]));

  const resolved = new Map<string, ResolvedRound>();
  for (const market of markets) {
    const businessDate = currentBusinessDate(market, now);
    if (!market.enabled) {
      resolved.set(market._id.toString(), {
        businessDate,
        round: null,
        state: "DISABLED",
        bettingWindow: getBettingWindow(false, null, now),
      });
      continue;
    }
    const round =
      byKey.get(`${market._id.toString()}:${businessDate}`) ?? (await ensureMarketRound(market, businessDate));
    const roundState = roundStateOf(round);
    resolved.set(market._id.toString(), {
      businessDate: round.businessDate,
      round,
      state: deriveMarketStatus(true, roundState, now),
      bettingWindow: getBettingWindow(true, roundState, now),
    });
  }
  return resolved;
}

export async function getMarketWithCurrentRound(
  slug: string,
  now: Date,
): Promise<{ market: MarketDoc; resolved: ResolvedRound }> {
  const market = await getMarketBySlug(slug);
  return { market, resolved: await resolveCurrentRound(market, now) };
}

export async function getMarketsWithCurrentRounds(
  now: Date,
): Promise<{ market: MarketDoc; resolved: ResolvedRound }[]> {
  const markets = await listMarkets();
  const resolved = await resolveCurrentRoundsForMarkets(markets, now);
  return markets.map((market) => ({ market, resolved: resolved.get(market._id.toString())! }));
}
