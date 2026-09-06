import type { EntryInput, NormalizedSelection } from "../validators/bet-input";

export type EntryMethod = EntryInput["entryMethod"];

/**
 * Source metadata retained for a future bet ticket / revision reconstruction. It mirrors the
 * strict `bets.entryMetadata` sub-document shape (JODI `{numbers}`, CROSSING `{digits}`,
 * COPY_PASTE `{rawInput, palti}`). It is NEVER authoritative over the canonical selections —
 * settlement only ever needs `selections`.
 */
export type BetEntryMetadata =
  | { numbers: string[] }
  | { digits: string }
  | { rawInput: string; palti: boolean };

/**
 * Non-persisted, non-authoritative helper data a caller (quote response, later a builder UI)
 * can show without re-running business logic — e.g. "Using unique digits 4, 2, 8".
 */
export type BetEngineMetadata = {
  uniqueDigits?: string[];
  uniqueDigitCount?: number;
  parsedNumbers?: string[];
};

/**
 * The single normalized shape every entry method produces and every consumer (quote today;
 * placement / edit later) reuses. The canonical wager is `selections`.
 */
export type NormalizedBetEntry = {
  entryMethod: EntryMethod;
  selections: NormalizedSelection[];
  selectionCount: number;
  stakePerSelectionPaise: number;
  totalStakePaise: number;
  entryMetadata: BetEntryMetadata;
  engineMetadata: BetEngineMetadata;
};
