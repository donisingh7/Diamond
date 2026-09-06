import "server-only";
import { DomainError, type ErrorCode } from "@/lib/errors/domain-error";
import { safeMultiply } from "@/lib/money";
import type { MarketLifecycleState, MarketAvailabilityReason } from "@/lib/dates/market-time";
import { getMarketWithCurrentRound } from "@/modules/markets/services/market.service";
import { getPlatformSettings } from "@/modules/settings/services/platform-settings.service";
import { normalizeBetEntry } from "../engines/normalize";
import type { BetEngineMetadata, BetEntryMetadata, EntryMethod } from "../engines/types";
import { toEntryInput, type QuoteRequest } from "../validators/quote-input";

/**
 * A bet quote. Informational / validation only — it reserves no money, checks no wallet
 * balance, and creates no bet. It is explicitly NON-BINDING: actual placement (a later
 * window) revalidates market state, settings and funds server-side and must not trust a
 * stale client quote. `marketRoundId` is returned so that later placement can name the
 * intended round.
 */
export type BetQuote = {
  marketSlug: string;
  marketId: string;
  marketRoundId: string;
  businessDate: string;
  marketState: MarketLifecycleState;
  entryMethod: EntryMethod;
  entryMetadata: BetEntryMetadata;
  engineMetadata: BetEngineMetadata;
  selections: { number: string; stakePaise: number }[];
  selectionCount: number;
  stakePerSelectionPaise: number;
  totalStakePaise: number;
  currency: string;
  payoutMultiplier: number;
  /** stake for one selection × current multiplier — the COMPLETE credit for a winning
   *  selection (the stake is not added again). */
  perWinningSelectionCreditPaise: number;
  editCutoffAt: string;
  /** Whether a bet placed now could still be edited (false during the CLOSING_SOON /
   *  edit-locked interval, where new bets remain allowed). */
  editableAfterPlacing: boolean;
  binding: false;
  serverNow: string;
};

const BLOCK_MESSAGE: Record<MarketAvailabilityReason, string> = {
  MARKET_DISABLED: "This market is disabled.",
  ROUND_NOT_FOUND: "This market has no round open for betting.",
  MARKET_NOT_OPEN: "This market is not open for betting yet.",
  MARKET_CLOSED: "This market is closed for new bets.",
  EDIT_WINDOW_CLOSED: "This market is closed for new bets.",
};

/**
 * Build a quote for a would-be bet.
 *
 * Order of checks:
 *  1. read current platform settings (payout multiplier + minimum stake come from here,
 *     never a literal)
 *  2. normalize the entry method + stake through the pure engines (fails fast on bad input
 *     with no database round-trip)
 *  3. resolve the market's server-authoritative current round via the Window 3A helper —
 *     this may create today's operational round (the only write a quote performs; no bet,
 *     wallet or ledger document is ever written)
 *  4. gate on `getBettingWindow(...).canPlaceBet` — new bets are allowed on
 *     `[opensAt, closesAt)`; at exactly `closesAt` the quote fails; during the edit-locked
 *     CLOSING_SOON interval it still succeeds
 *
 * Never touches the wallet: balance is a later window and actual placement validates funds
 * atomically. The quote only reports the amount that WOULD be required.
 */
export async function quoteBet(request: QuoteRequest, now: Date): Promise<BetQuote> {
  const settings = await getPlatformSettings();
  const normalized = normalizeBetEntry(toEntryInput(request), request.stakePaise, settings.minimumStakePaise);

  const { market, resolved } = await getMarketWithCurrentRound(request.marketSlug, now);
  if (!resolved.round || !resolved.bettingWindow.canPlaceBet) {
    const reason: MarketAvailabilityReason = resolved.bettingWindow.reason ?? "MARKET_CLOSED";
    throw new DomainError(reason as ErrorCode, BLOCK_MESSAGE[reason]);
  }

  const round = resolved.round;
  const perWinningSelectionCreditPaise = safeMultiply(request.stakePaise, settings.payoutMultiplier);

  return {
    marketSlug: market.slug,
    marketId: market._id.toString(),
    marketRoundId: round._id.toString(),
    businessDate: round.businessDate,
    marketState: resolved.state,
    entryMethod: normalized.entryMethod,
    entryMetadata: normalized.entryMetadata,
    engineMetadata: normalized.engineMetadata,
    selections: normalized.selections,
    selectionCount: normalized.selectionCount,
    stakePerSelectionPaise: normalized.stakePerSelectionPaise,
    totalStakePaise: normalized.totalStakePaise,
    currency: settings.currency,
    payoutMultiplier: settings.payoutMultiplier,
    perWinningSelectionCreditPaise,
    editCutoffAt: round.editCutoffAt.toISOString(),
    editableAfterPlacing: resolved.bettingWindow.canEditBet,
    binding: false,
    serverNow: now.toISOString(),
  };
}
