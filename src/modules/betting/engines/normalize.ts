import { DomainError } from "@/lib/errors/domain-error";
import { safeMultiply } from "@/lib/money";
import type { EntryInput } from "../validators/bet-input";
import { generateCrossing } from "./crossing.engine";
import { normalizeJodi } from "./jodi.engine";
import { parseCopyPaste } from "./copy-paste.engine";
import { expandPalti } from "./palti.engine";
import { dedupePreservingOrder } from "./selection";
import type { BetEngineMetadata, BetEntryMetadata, NormalizedBetEntry } from "./types";

const MAX_SELECTIONS = 100;

/**
 * Stake is validated as configuration-driven data: the minimum comes from
 * `platformSettings.minimumStakePaise`, never a literal. `safeMultiply` further rejects any
 * non-safe-integer or overflowing arithmetic.
 */
function assertStake(stakePaise: number, minimumStakePaise: number): void {
  if (!Number.isSafeInteger(stakePaise)) {
    throw new DomainError("MONEY_OUT_OF_RANGE", "Stake must be a whole number of paise within supported precision.");
  }
  if (stakePaise < minimumStakePaise) {
    throw new DomainError("STAKE_BELOW_MINIMUM", `Minimum stake is ${minimumStakePaise} paise per selection.`);
  }
}

/**
 * The one normalization entry point. Turns any entry method + a single common stake into the
 * canonical selection list, applying the same stake to every generated/selected number.
 *
 * Pure and reusable by the quote service now and by future placement / edit services — it
 * must never query MongoDB, inspect the wallet or clock, generate a public reference, or
 * create a bet.
 */
export function normalizeBetEntry(
  input: EntryInput,
  stakePaise: number,
  minimumStakePaise: number,
): NormalizedBetEntry {
  assertStake(stakePaise, minimumStakePaise);

  let numbers: string[];
  let entryMetadata: BetEntryMetadata;
  let engineMetadata: BetEngineMetadata = {};

  switch (input.entryMethod) {
    case "JODI": {
      numbers = normalizeJodi(input.numbers);
      entryMetadata = { numbers: [...input.numbers] };
      break;
    }
    case "CROSSING": {
      const crossing = generateCrossing(input.digits);
      numbers = crossing.numbers;
      entryMetadata = { digits: input.digits };
      engineMetadata = { uniqueDigits: crossing.uniqueDigits, uniqueDigitCount: crossing.uniqueDigitCount };
      break;
    }
    case "COPY_PASTE": {
      const parsed = parseCopyPaste(input.rawInput);
      numbers = input.palti ? expandPalti(parsed) : dedupePreservingOrder(parsed);
      entryMetadata = { rawInput: input.rawInput, palti: input.palti };
      engineMetadata = { parsedNumbers: dedupePreservingOrder(parsed) };
      break;
    }
  }

  if (numbers.length === 0) {
    throw new DomainError("INVALID_SELECTION", "No valid selections were produced.");
  }
  if (numbers.length > MAX_SELECTIONS) {
    throw new DomainError("INVALID_SELECTION", `Too many selections (maximum ${MAX_SELECTIONS}).`);
  }

  const selections = numbers.map((number) => ({ number, stakePaise }));
  const totalStakePaise = safeMultiply(stakePaise, selections.length);

  return {
    entryMethod: input.entryMethod,
    selections,
    selectionCount: selections.length,
    stakePerSelectionPaise: stakePaise,
    totalStakePaise,
    entryMetadata,
    engineMetadata,
  };
}
