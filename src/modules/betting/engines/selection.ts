import { DomainError } from "@/lib/errors/domain-error";

/**
 * Canonical betting selection primitives. A canonical selection number is ALWAYS a
 * two-character decimal string ("00"–"99") — leading zeros must survive every
 * transformation and no engine may ever coerce one to an integer.
 *
 * These helpers are pure: no database, no wallet, no clock, no React. They are the
 * shared foundation every entry-method engine (Jodi / Crossing / Copy Paste / Palti)
 * and the quote / future placement / future edit services normalize through.
 */
export const TWO_DIGIT = /^\d{2}$/;

export function isTwoDigitString(value: unknown): value is string {
  return typeof value === "string" && TWO_DIGIT.test(value);
}

export function assertTwoDigit(value: unknown): string {
  if (!isTwoDigitString(value)) {
    throw new DomainError("INVALID_SELECTION", `"${String(value)}" is not a two-digit number (00–99).`);
  }
  return value;
}

/** "07" -> "70", "10" -> "01", "22" -> "22" (self-palindrome). */
export function reverseTwoDigit(value: string): string {
  const number = assertTwoDigit(value);
  return `${number[1]}${number[0]}`;
}

/** Stable de-duplication: keeps the first occurrence, preserves input order. */
export function dedupePreservingOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}
