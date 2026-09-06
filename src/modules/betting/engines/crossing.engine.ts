import { DomainError } from "@/lib/errors/domain-error";

/** Defensive upper bound on raw input length. Crossing is naturally bounded at 10 unique
 *  digits -> 100 canonical selections; this only rejects pathological input. */
const MAX_DIGITS_INPUT = 100;

export type CrossingResult = {
  /** Deduplicated source digits in first-appearance order — reconstruction/UI metadata. */
  uniqueDigits: string[];
  uniqueDigitCount: number;
  /** Canonical two-digit selections: the full ordered Cartesian product, self-pairs included. */
  numbers: string[];
};

/**
 * CROSSING — the player enters a digit string; the engine crosses every unique digit with
 * every unique digit (including itself).
 *
 * Rules (frozen — see DOMAIN_RULES.md "CROSSING RULES" + "Window 4A1"):
 *  - deduplicate source digits FIRST, preserving first-appearance order ("4428" -> 4,2,8)
 *  - generate the ordered Cartesian product uniqueDigits × uniqueDigits; SELF PAIRS ARE
 *    INCLUDED ("44", "22", ...)
 *  - duplicate source digits must NOT multiply selections ("4428" -> 3×3 = 9)
 *  - n unique digits -> exactly n² selections; naturally bounded at 10×10 = 100
 *  - deterministic ordering: outer loop = first digit in first-appearance order, inner loop
 *    = second digit in the same order. For "428":
 *      44 42 48  24 22 28  84 82 88
 *  - leading zeros preserved ("012" -> ... "00" "01" "02" "10" ...)
 *
 * Pure: no database, wallet, clock, persistence or React.
 */
export function generateCrossing(digits: string): CrossingResult {
  if (!/^\d+$/.test(digits)) {
    throw new DomainError("INVALID_SELECTION", "Crossing input must contain digits only.");
  }
  if (digits.length > MAX_DIGITS_INPUT) {
    throw new DomainError("INVALID_SELECTION", "Crossing input is too long.");
  }

  const uniqueDigits: string[] = [];
  for (const digit of digits) {
    if (!uniqueDigits.includes(digit)) uniqueDigits.push(digit);
  }

  const numbers: string[] = [];
  for (const first of uniqueDigits) {
    for (const second of uniqueDigits) {
      numbers.push(`${first}${second}`);
    }
  }

  return { uniqueDigits, uniqueDigitCount: uniqueDigits.length, numbers };
}
