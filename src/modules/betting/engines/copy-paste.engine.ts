import { DomainError } from "@/lib/errors/domain-error";
import { TWO_DIGIT } from "./selection";

/** Defensive upper bound on raw pasted input. */
const MAX_RAW_INPUT = 2000;

/** Allowed separators: ASCII/unicode whitespace, comma, dot. Hyphen and other punctuation
 *  are NOT separators (existing docs do not permit them). */
const SEPARATOR = /[\s,.]/;
const SEPARATOR_RUN = /[\s,.]+/;

/**
 * COPY PASTE — parse pasted text into an ordered list of exact two-digit numbers.
 *
 * Rules (frozen — see DOMAIN_RULES.md "COPY PASTE RULES" + "Window 4A1"):
 *  - supported forms: one contiguous even-length digit run ("2215489635"), or numbers
 *    separated by spaces / commas / dots ("22 15 48", "22,15,48", "22.15.48"); mixed runs
 *    of those separators are tolerated
 *  - fail-closed: any token that is not exactly two digits rejects the WHOLE input
 *    ("1", "123", "22,1,48", "ab22", "" all throw) — the parser never invents or drops a
 *    digit to make malformed input parse
 *  - leading zeros preserved ("00 07 10" -> "00","07","10")
 *  - order preserved; duplicates are NOT removed here (the normalizer decides that, because
 *    the Palti step must see the original sequence)
 *
 * Pure: no database, wallet, clock, persistence or React. Independent of React/HTTP.
 */
export function parseCopyPaste(rawInput: string): string[] {
  const raw = rawInput.trim();
  if (raw.length === 0) {
    throw new DomainError("INVALID_SELECTION", "Enter at least one two-digit number.");
  }
  if (raw.length > MAX_RAW_INPUT) {
    throw new DomainError("INVALID_SELECTION", "Input is too long.");
  }

  let tokens: string[];
  if (SEPARATOR.test(raw)) {
    tokens = raw.split(SEPARATOR_RUN).filter((token) => token.length > 0);
  } else {
    if (!/^\d+$/.test(raw)) {
      throw new DomainError("INVALID_SELECTION", "Only digits separated by spaces, commas or dots are allowed.");
    }
    if (raw.length % 2 !== 0) {
      throw new DomainError("INVALID_SELECTION", "Provide an even number of digits so every number has two.");
    }
    tokens = raw.match(/.{2}/g) ?? [];
  }

  if (tokens.length === 0) {
    throw new DomainError("INVALID_SELECTION", "Enter at least one two-digit number.");
  }
  for (const token of tokens) {
    if (!TWO_DIGIT.test(token)) {
      throw new DomainError("INVALID_SELECTION", `"${token}" is not a two-digit number (00–99).`);
    }
  }
  return tokens;
}
