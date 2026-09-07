import "server-only";
import { Types } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import { marketScheduleSchema } from "@/lib/dates/market-time";
import { writeAuditLog } from "@/modules/audit/services/audit-log.service";
import { Market, type MarketRecord } from "@/modules/markets/models/market.model";
import { resolveCurrentRound, type MarketDoc } from "@/modules/markets/services/market.service";

/**
 * Admin market management (Window 6A2) — read the config + current lifecycle, enable /
 * emergency-disable, and edit the FUTURE schedule. Enable/disable and schedule edits change
 * only the `markets` configuration row; persisted `marketRounds` snapshots
 * (`opensAt` / `editCutoffAt` / `closesAt`) are NEVER rewritten — a schedule change applies to
 * rounds created after it. Emergency disable takes effect immediately through the existing
 * server-authoritative eligibility checks (`resolveCurrentRound` returns `round: null` +
 * `DISABLED`, `getBettingWindow(false, …)` blocks new bets), with no per-round mutation.
 */

const HEX24 = /^[a-f0-9]{24}$/i;

// --- DTO ------------------------------------------------------------------------------

export type AdminMarketRoundSnapshot = {
  id: string;
  businessDate: string;
  opensAt: string;
  editCutoffAt: string;
  closesAt: string;
  state: string;
  result: string | null;
  resultDeclaredAt: string | null;
  settlementStatus: string;
};

export type AdminMarketDTO = {
  id: string;
  name: string;
  slug: string;
  code: string;
  timezone: string;
  enabled: boolean;
  schedule: {
    openTime: string;
    closeTime: string;
    openTimeMinutes: number;
    closeTimeMinutes: number;
    closeDayOffset: number;
    editLockMinutesBeforeClose: number;
  };
  displayOrder: number;
  state: string;
  currentBusinessDate: string;
  currentRound: AdminMarketRoundSnapshot | null;
};

function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function clockToMinutes(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

async function toAdminMarketDTO(market: MarketDoc, now: Date): Promise<AdminMarketDTO> {
  const resolved = await resolveCurrentRound(market, now);
  const round = resolved.round;
  return {
    id: market._id.toString(),
    name: market.name,
    slug: market.slug,
    code: market.code,
    timezone: market.timezone,
    enabled: market.enabled,
    schedule: {
      openTime: minutesToClock(market.openTimeMinutes),
      closeTime: minutesToClock(market.closeTimeMinutes),
      openTimeMinutes: market.openTimeMinutes,
      closeTimeMinutes: market.closeTimeMinutes,
      closeDayOffset: market.closeDayOffset,
      editLockMinutesBeforeClose: market.editLockMinutesBeforeClose,
    },
    displayOrder: market.displayOrder,
    state: resolved.state,
    currentBusinessDate: resolved.businessDate,
    currentRound: round
      ? {
          id: round._id.toString(),
          businessDate: round.businessDate,
          opensAt: round.opensAt.toISOString(),
          editCutoffAt: round.editCutoffAt.toISOString(),
          closesAt: round.closesAt.toISOString(),
          state: resolved.state,
          result: round.result ?? null,
          resultDeclaredAt: round.resultDeclaredAt?.toISOString() ?? null,
          settlementStatus: round.settlementStatus,
        }
      : null,
  };
}

// --- resolve / read ---------------------------------------------------------------

/** A hydrated market by 24-hex id. A missing / malformed id is `MARKET_NOT_FOUND` (404). */
export async function resolveMarket(marketId: string): Promise<MarketDoc> {
  const trimmed = marketId.trim();
  if (!HEX24.test(trimmed)) throw new DomainError("MARKET_NOT_FOUND", "Market not found.");
  const market = await Market.findById(new Types.ObjectId(trimmed));
  if (!market) throw new DomainError("MARKET_NOT_FOUND", "Market not found.");
  return market;
}

export type AdminMarketsListOptions = { enabled?: boolean };

export async function listMarketsForAdmin(
  options: AdminMarketsListOptions = {},
  now: Date = new Date(),
): Promise<{ markets: AdminMarketDTO[] }> {
  const filter: Record<string, unknown> = {};
  if (options.enabled !== undefined) filter.enabled = options.enabled;
  const rows = await Market.find(filter).sort({ displayOrder: 1, _id: 1 }).exec();
  const markets = await Promise.all(rows.map((market) => toAdminMarketDTO(market, now)));
  return { markets };
}

export async function getMarketForAdmin(marketId: string, now: Date = new Date()): Promise<AdminMarketDTO> {
  return toAdminMarketDTO(await resolveMarket(marketId), now);
}

// --- enable / disable -----------------------------------------------------------

export type SetMarketEnabledInput = {
  actorAdminId: Types.ObjectId;
  marketId: string;
  enabled: boolean;
};

/**
 * `enabled` flip via a CAS `updateOne` inside a transaction, plus a `MARKET_ENABLED` /
 * `MARKET_DISABLED` audit row carrying the before/after flag. Idempotent: setting the market to
 * a state it is already in is a no-op that writes no second audit row. `marketRounds` are not
 * touched — re-enabling returns the market to whatever lifecycle its schedule + the clock imply.
 */
export async function setMarketEnabled(input: SetMarketEnabledInput): Promise<AdminMarketDTO> {
  const market = await resolveMarket(input.marketId);
  if (market.enabled === input.enabled) return toAdminMarketDTO(market, new Date());

  await withTransaction(async (session) => {
    const res = await Market.updateOne(
      { _id: market._id, enabled: !input.enabled },
      { $set: { enabled: input.enabled } },
      { session },
    );
    if (res.matchedCount !== 1) return;
    await writeAuditLog(
      {
        actorAdminId: input.actorAdminId,
        action: input.enabled ? "MARKET_ENABLED" : "MARKET_DISABLED",
        entityType: "Market",
        entityId: market._id,
        before: { enabled: !input.enabled },
        after: { enabled: input.enabled },
      },
      session,
    );
  });
  return getMarketForAdmin(input.marketId);
}

// --- schedule -----------------------------------------------------------------

export type UpdateMarketScheduleInput = {
  actorAdminId: Types.ObjectId;
  marketId: string;
  openTime?: string;
  closeTime?: string;
  closeDayOffset?: 0 | 1;
  editLockMinutesBeforeClose?: number;
};

type ScheduleSnapshot = Pick<
  MarketRecord,
  "openTimeMinutes" | "closeTimeMinutes" | "closeDayOffset" | "editLockMinutesBeforeClose"
>;

function scheduleSnapshot(market: MarketDoc): ScheduleSnapshot {
  return {
    openTimeMinutes: market.openTimeMinutes,
    closeTimeMinutes: market.closeTimeMinutes,
    closeDayOffset: market.closeDayOffset,
    editLockMinutesBeforeClose: market.editLockMinutesBeforeClose,
  };
}

/**
 * Merge the supplied fields onto the market's current schedule, validate the result
 * (`marketScheduleSchema` — timezone, ranges, close-follows-open incl. cross-midnight) plus a
 * "the edit lock must sit inside the round" check, then persist. Writes a
 * `MARKET_SCHEDULE_UPDATED` audit row with safe before/after snapshots. Existing `marketRounds`
 * are untouched — `ensureMarketRound` snapshots times at round creation and never recomputes,
 * so this only affects rounds created after the change.
 */
export async function updateMarketSchedule(input: UpdateMarketScheduleInput): Promise<AdminMarketDTO> {
  const market = await resolveMarket(input.marketId);
  const before = scheduleSnapshot(market);

  const next: ScheduleSnapshot = {
    openTimeMinutes: input.openTime !== undefined ? clockToMinutes(input.openTime) : before.openTimeMinutes,
    closeTimeMinutes: input.closeTime !== undefined ? clockToMinutes(input.closeTime) : before.closeTimeMinutes,
    closeDayOffset: input.closeDayOffset ?? before.closeDayOffset,
    editLockMinutesBeforeClose:
      input.editLockMinutesBeforeClose ?? before.editLockMinutesBeforeClose,
  };

  const parsed = marketScheduleSchema.safeParse({ timezone: market.timezone, ...next });
  if (!parsed.success) {
    throw new DomainError("INVALID_INPUT", "The resulting market schedule is invalid.");
  }
  const roundLengthMinutes = next.closeDayOffset * 1440 + next.closeTimeMinutes - next.openTimeMinutes;
  if (next.editLockMinutesBeforeClose >= roundLengthMinutes) {
    throw new DomainError("INVALID_INPUT", "The edit lock must be shorter than the betting round.");
  }

  const unchanged =
    before.openTimeMinutes === next.openTimeMinutes
    && before.closeTimeMinutes === next.closeTimeMinutes
    && before.closeDayOffset === next.closeDayOffset
    && before.editLockMinutesBeforeClose === next.editLockMinutesBeforeClose;
  if (unchanged) return toAdminMarketDTO(market, new Date());

  await withTransaction(async (session) => {
    const res = await Market.updateOne({ _id: market._id }, { $set: next }, { session, runValidators: true });
    if (res.matchedCount !== 1) throw new DomainError("MARKET_NOT_FOUND", "Market not found.");
    await writeAuditLog(
      {
        actorAdminId: input.actorAdminId,
        action: "MARKET_SCHEDULE_UPDATED",
        entityType: "Market",
        entityId: market._id,
        before,
        after: next,
      },
      session,
    );
  });
  return getMarketForAdmin(input.marketId);
}
