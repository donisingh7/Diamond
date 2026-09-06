import { DateTime } from "luxon";
import { z } from "zod";

export const marketScheduleSchema = z.object({
  timezone: z.literal("Asia/Kolkata"),
  openTimeMinutes: z.number().int().min(0).max(1439),
  closeTimeMinutes: z.number().int().min(0).max(1439),
  closeDayOffset: z.number().int().min(0).max(1),
  editLockMinutesBeforeClose: z.number().int().nonnegative(),
}).refine((s) => s.closeDayOffset * 1440 + s.closeTimeMinutes > s.openTimeMinutes,
  { message: "Close must follow open." });

export type MarketSchedule = z.infer<typeof marketScheduleSchema>;
export type RoundTimes = { opensAt: Date; editCutoffAt: Date; closesAt: Date };
export type RoundState = RoundTimes & {
  result?: string | null;
  settlementStatus: "PENDING" | "PROCESSING" | "SETTLED" | "FAILED";
};

function localDate(businessDate: string, timezone: string) {
  const day = DateTime.fromISO(businessDate, { zone: timezone });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !day.isValid || day.toISODate() !== businessDate) {
    throw new Error("Invalid market business date.");
  }
  return day.startOf("day");
}

export function getRoundTimes(input: MarketSchedule, businessDate: string): RoundTimes {
  const schedule = marketScheduleSchema.parse(input);
  const day = localDate(businessDate, schedule.timezone);
  const opensAt = day.plus({ minutes: schedule.openTimeMinutes });
  const closesAt = day.plus({ days: schedule.closeDayOffset, minutes: schedule.closeTimeMinutes });
  return {
    opensAt: opensAt.toJSDate(),
    closesAt: closesAt.toJSDate(),
    editCutoffAt: closesAt.minus({ minutes: schedule.editLockMinutesBeforeClose }).toJSDate(),
  };
}

/** The overnight round owns the instant before its close; the gap maps to today's upcoming round. */
export function resolveMarketBusinessDate(input: MarketSchedule, now: Date): string {
  const schedule = marketScheduleSchema.parse(input);
  const local = DateTime.fromJSDate(now, { zone: schedule.timezone });
  if (!local.isValid) throw new Error("Invalid server time.");
  const previous = local.minus({ days: 1 }).toISODate()!;
  const previousTimes = getRoundTimes(schedule, previous);
  if (now >= previousTimes.opensAt && now < previousTimes.closesAt) return previous;
  return local.toISODate()!;
}

export function isBetPlacementAllowed(enabled: boolean, round: RoundState, now: Date): boolean {
  return enabled && round.result == null && round.settlementStatus === "PENDING"
    && now >= round.opensAt && now < round.closesAt;
}

export function isBetEditAllowed(enabled: boolean, round: RoundState, now: Date, betStatus: "ACTIVE" | "WON" | "LOST"): boolean {
  return betStatus === "ACTIVE" && isBetPlacementAllowed(enabled, round, now) && now < round.editCutoffAt;
}

export function deriveMarketStatus(enabled: boolean, round: RoundState, now: Date) {
  if (!enabled) return "DISABLED";
  if (round.settlementStatus === "SETTLED") return "SETTLED";
  if (round.result != null) return "RESULT_DECLARED";
  if (now < round.opensAt) return "UPCOMING";
  if (now >= round.closesAt) return "RESULT_PENDING";
  if (now >= round.editCutoffAt) return "CLOSING_SOON";
  return "OPEN";
}
