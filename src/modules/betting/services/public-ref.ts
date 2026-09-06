import "server-only";
import { randomInt } from "node:crypto";

/**
 * Human-readable public bet reference — `<MARKET CODE>-<MMDD>-<random 5>`, e.g. `FB-0906-X7K29`.
 *
 * Requirements (DOMAIN_RULES.md "USER-FACING BET REFERENCE" + Window 4A3 §20/§21):
 *  - reasonably short, human-readable, safe to search
 *  - generated server-side only, never client-controlled
 *  - NOT a sequential / internal identifier — leaks no ordering or Mongo `_id`
 *  - collision-resistant: a cryptographically-random suffix over a 31-symbol alphabet gives
 *    31^5 ≈ 28.6M references per (market, business date); a rare collision is caught by the
 *    unique `bets.publicRef` index and retried a bounded number of times
 *  - stable forever for that bet — the schema field is `immutable`, so it survives every later
 *    edit and is NEVER regenerated on an idempotent replay
 */

/** Crockford-style uppercase alphabet with the ambiguous glyphs I, O, 0, 1 removed. */
export const PUBLIC_REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PUBLIC_REF_SUFFIX_LENGTH = 5;
/** Insert attempts before a persistent `publicRef` collision is surfaced as an error. */
export const PUBLIC_REF_MAX_ATTEMPTS = 5;

/** "2026-09-06" -> "0906" (the MMDD business-day component). */
export function businessDateRefComponent(businessDate: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) throw new Error(`Invalid business date for public reference: ${businessDate}`);
  return `${match[1]}${match[2]}`;
}

function randomSuffix(): string {
  let out = "";
  for (let i = 0; i < PUBLIC_REF_SUFFIX_LENGTH; i += 1) {
    out += PUBLIC_REF_ALPHABET[randomInt(0, PUBLIC_REF_ALPHABET.length)];
  }
  return out;
}

export type PublicRefGenerator = (marketCode: string, businessDate: string) => string;

export const generatePublicRef: PublicRefGenerator = (marketCode, businessDate) =>
  `${marketCode.toUpperCase()}-${businessDateRefComponent(businessDate)}-${randomSuffix()}`;
