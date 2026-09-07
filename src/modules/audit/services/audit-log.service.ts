import "server-only";
import type { ClientSession, Types } from "mongoose";
import { AuditLog } from "../models/audit-log.model";

/**
 * The single writer for `auditLogs`. Every meaningful admin action funnels through here so the
 * redaction allow-list and the "always tag player data with `subjectUserId`" rule are enforced
 * in one place (ADMIN_SPEC.md "AUDIT LOGS", CODEX_RULES #23).
 *
 * Rows are created-only (`createdOnlyOptions` on the schema) — never edited, never deleted in
 * normal operation. The one deletion exception is `playerDeletionService.purgePlayer`, which
 * removes every row whose `subjectUserId` / `entityId` links back to the purged player and then
 * writes a single generic `PLAYER_DELETION_COMPLETED` row carrying NO player identifier.
 */

export const auditActions = [
  "PLAYER_CREATED",
  "PLAYER_DISABLED",
  "PLAYER_ENABLED",
  "PLAYER_PASSWORD_RESET",
  "PLAYER_DELETION_COMPLETED",
  "ADMIN_WALLET_CREDIT",
  "ADMIN_WALLET_DEBIT",
  // Window 6A2 — admin operations. `MARKET_SCHEDULE_UPDATED` / `RESULT_DECLARED` /
  // `PAYOUT_RATE_UPDATED` are the concrete names for the roadmap's example
  // `MARKET_TIME_CHANGED` / `GAME_RATE_CHANGED` placeholders (no business rule changed).
  "WITHDRAWAL_APPROVED",
  "WITHDRAWAL_REJECTED",
  "MARKET_ENABLED",
  "MARKET_DISABLED",
  "MARKET_SCHEDULE_UPDATED",
  "RESULT_DECLARED",
  "PAYOUT_RATE_UPDATED",
] as const;
export type AuditAction = (typeof auditActions)[number];

/** Keys that must never reach `auditLogs`, matched case-insensitively at any nesting depth. */
const REDACTED_KEYS = [
  "password",
  "passwordhash",
  "newpassword",
  "currentpassword",
  "token",
  "tokenhash",
  "rawtoken",
  "sessiontoken",
  "codehash",
  "otp",
  "otpcode",
  "secret",
  "sessionsecret",
];

const REDACTED = "[REDACTED]";

/** Deep-copy `value`, replacing any value whose key is in {@link REDACTED_KEYS} with a marker. */
export function redactAuditSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditSnapshot);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.includes(key.toLowerCase()) ? REDACTED : redactAuditSnapshot(inner);
    }
    return out;
  }
  return value;
}

export type WriteAuditLogInput = {
  actorAdminId: Types.ObjectId;
  action: AuditAction;
  /** A coarse noun for the affected entity ("User", "Wallet", "Player"). Never an identifier. */
  entityType: string;
  /** The affected document's id, when linking is allowed. Omit for the post-purge generic row. */
  entityId?: Types.ObjectId;
  /** The player this row is about — REQUIRED whenever the row concerns a specific player, so
   *  `purgePlayer` can find and delete it. Omit only for genuinely player-agnostic rows. */
  subjectUserId?: Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

/**
 * Append one immutable audit row. Pass `session` to enlist the write in the caller's MongoDB
 * transaction so the audited change and its audit trail are atomic.
 */
export async function writeAuditLog(input: WriteAuditLogInput, session?: ClientSession): Promise<void> {
  const doc = {
    actorAdminId: input.actorAdminId,
    action: input.action,
    entityType: input.entityType,
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.subjectUserId ? { subjectUserId: input.subjectUserId } : {}),
    ...(input.before ? { before: redactAuditSnapshot(input.before) as Record<string, unknown> } : {}),
    ...(input.after ? { after: redactAuditSnapshot(input.after) as Record<string, unknown> } : {}),
  };
  await AuditLog.create([doc], session ? { session } : {});
}
