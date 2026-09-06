import type { EntryInput } from "../validators/bet-input";
import type { NormalizedBetEntry } from "./types";

/**
 * Window 4A1 implements these pure engines (jodi / crossing / copy-paste / palti / normalize).
 * `NormalizeBet` now returns the full `NormalizedBetEntry` contract (selections + metadata +
 * counts + totals) rather than a bare selection array, so quote, and later placement and edit,
 * all consume one shape. No fake execution path.
 */
export type NormalizeBet = (
  input: EntryInput,
  stakePaise: number,
  minimumStakePaise: number,
) => NormalizedBetEntry;

export type ApplyPalti = (numbers: readonly string[]) => readonly string[];

export type { NormalizedBetEntry } from "./types";
