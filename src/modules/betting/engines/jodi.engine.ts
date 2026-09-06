import { DomainError } from "@/lib/errors/domain-error";
import { assertTwoDigit, dedupePreservingOrder } from "./selection";

/**
 * JODI — the player picks one or more exact two-digit numbers ("00"–"99"). Every picked
 * number later receives the same submitted stake.
 *
 * Rules (frozen — see DOMAIN_RULES.md "JODI RULES" + "Window 4A1"):
 *  - each entry must be an exact two-character string; "7", "100", "-1", "ab" are rejected
 *  - leading zeros are preserved ("07" stays "07")
 *  - an empty selection list is rejected
 *  - duplicates COLLAPSE to a single canonical selection (first occurrence kept, order
 *    preserved) rather than being charged twice — the API Zod layer does not require
 *    uniqueness, so the engine is the safe normalization point
 *  - output is deterministic and unique; at most 100 distinct numbers can exist
 *
 * Pure: no database, wallet, clock, persistence or React.
 */
export function normalizeJodi(numbers: readonly string[]): string[] {
  if (numbers.length === 0) {
    throw new DomainError("INVALID_SELECTION", "Select at least one number.");
  }
  for (const number of numbers) assertTwoDigit(number);
  const canonical = dedupePreservingOrder(numbers);
  if (canonical.length > 100) {
    throw new DomainError("INVALID_SELECTION", "Too many selections (maximum 100).");
  }
  return canonical;
}
