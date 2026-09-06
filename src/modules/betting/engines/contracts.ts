import type { EntryInput, NormalizedSelection } from "../validators/bet-input";

/** Window 4 supplies jodi/crossing/copy-paste/palti engines. No fake execution path. */
export type NormalizeBet = (input: EntryInput, stakePaise: number, minimumStakePaise: number) => readonly NormalizedSelection[];
export type ApplyPalti = (numbers: readonly string[]) => readonly string[];
