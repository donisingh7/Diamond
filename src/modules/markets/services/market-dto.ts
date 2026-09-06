import "server-only";
import type { MarketDoc, ResolvedRound } from "./market.service";

/** Player-facing round shape: ISO instants, YYYY-MM-DD business date, 2-char result string or null. */
export type RoundDTO = {
  id: string;
  businessDate: string;
  opensAt: string;
  editCutoffAt: string;
  closesAt: string;
  state: ResolvedRound["state"];
  result: string | null;
  resultDeclaredAt: string | null;
  settlementStatus: string;
  canPlaceBet: boolean;
  canEditBet: boolean;
  unavailableReason: string | null;
};

export type MarketDTO = {
  id: string;
  name: string;
  slug: string;
  code: string;
  timezone: string;
  enabled: boolean;
  editLockMinutesBeforeClose: number;
  displayOrder: number;
  state: ResolvedRound["state"];
  round: RoundDTO | null;
};

/** No admin identifiers, no Mongo internals, no schedule-minute fields the player never needs. */
export function toMarketDTO(market: MarketDoc, resolved: ResolvedRound): MarketDTO {
  const { round, bettingWindow } = resolved;
  return {
    id: market._id.toString(),
    name: market.name,
    slug: market.slug,
    code: market.code,
    timezone: market.timezone,
    enabled: market.enabled,
    editLockMinutesBeforeClose: market.editLockMinutesBeforeClose,
    displayOrder: market.displayOrder,
    state: resolved.state,
    round: round
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
          canPlaceBet: bettingWindow.canPlaceBet,
          canEditBet: bettingWindow.canEditBet,
          unavailableReason: bettingWindow.reason ?? null,
        }
      : null,
  };
}
