import "server-only";
import { Types } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";

/**
 * Shared opaque `(createdAt|requestedAt, _id)` keyset cursor for the Window 6A2 admin list
 * endpoints — the same base64url-over-JSON scheme the player read services use, factored out
 * because 6A2 adds four bounded lists (withdrawals, audit, bets, plus reuse elsewhere).
 */

const HEX24 = /^[a-f0-9]{24}$/i;

export type KeysetCursor = { t: number; id: string };

export function encodeCursor(at: Date, id: Types.ObjectId): string {
  return Buffer.from(JSON.stringify({ t: at.getTime(), id: id.toHexString() })).toString("base64url");
}

export function decodeCursor(raw: string): KeysetCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" || parsed === null
      || typeof (parsed as KeysetCursor).t !== "number"
      || !Number.isFinite((parsed as KeysetCursor).t)
      || typeof (parsed as KeysetCursor).id !== "string"
      || !HEX24.test((parsed as KeysetCursor).id)
    ) {
      throw new Error("malformed cursor");
    }
    return { t: (parsed as KeysetCursor).t, id: (parsed as KeysetCursor).id };
  } catch {
    throw new DomainError("INVALID_INPUT", "Invalid pagination cursor.");
  }
}

/** Mongo `$or` clause for "strictly older than `(t, id)`" on a descending `(field, _id)` sort. */
export function olderThan(field: string, cursor: KeysetCursor): Record<string, unknown>[] {
  const at = new Date(cursor.t);
  return [
    { [field]: { $lt: at } },
    { [field]: at, _id: { $lt: new Types.ObjectId(cursor.id) } },
  ];
}

export function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}
