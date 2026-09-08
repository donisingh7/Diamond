import type { MarketDTO } from "@/modules/markets/services/market-dto";
import type { Tone } from "@/components/ui/feedback";

/** Labels only. Eligibility and the operational round always come from the API. */
export const marketStates: Record<MarketDTO["state"], { label: string; tone: Tone }> = {
  DISABLED: { label: "Unavailable", tone: "neutral" },
  UPCOMING: { label: "Upcoming", tone: "info" },
  OPEN: { label: "Open", tone: "success" },
  CLOSING_SOON: { label: "Closing soon", tone: "warning" },
  RESULT_PENDING: { label: "Result pending", tone: "neutral" },
  RESULT_DECLARED: { label: "Result declared", tone: "success" },
  SETTLED: { label: "Settled", tone: "success" },
};

export function marketTime(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(instant));
}

export function businessDateLabel(date: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));
}

export function marketDateTime(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(instant));
}

export function countdownTarget(market: MarketDTO) {
  if (!market.round) return null;
  if (market.state === "UPCOMING") return { target: market.round.opensAt, label: "Opens in" };
  if (market.round.canPlaceBet) return { target: market.round.closesAt, label: "Closes in" };
  return null;
}
