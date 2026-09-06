import { reverseTwoDigit } from "./selection";

/**
 * PALTI — an option inside COPY PASTE (NOT a separate bet type). For each entered two-digit
 * number, also include its reverse.
 *
 * Rules (frozen — see DOMAIN_RULES.md "COPY PASTE RULES / With Palti" + "Window 4A1"):
 *  - process the originals in input order
 *  - emit the original first, then its reverse if not already emitted
 *  - de-duplicate globally across the whole result
 *  - self-palindromes ("00", "11", "22", ...) appear once
 *
 * For "22 15 48 96 35" -> 22, 15, 51, 48, 84, 96, 69, 35, 53
 *
 * Pure: no database, wallet, clock, persistence or React.
 */
export function expandPalti(numbers: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const number of numbers) {
    const reversed = reverseTwoDigit(number);
    if (!seen.has(number)) {
      seen.add(number);
      out.push(number);
    }
    if (!seen.has(reversed)) {
      seen.add(reversed);
      out.push(reversed);
    }
  }
  return out;
}
