import "server-only";
import { Types, type QueryFilter } from "mongoose";
import { AuditLog } from "@/modules/audit/models/audit-log.model";
import { redactAuditSnapshot } from "@/modules/audit/services/audit-log.service";
import { clampLimit, decodeCursor, encodeCursor, olderThan } from "./pagination";

/**
 * Admin audit browser backend (Window 6A2). Bounded, newest-first, filterable read of
 * `auditLogs`. Rows are already redacted at write time by `writeAuditLog`; this read path
 * re-runs `redactAuditSnapshot` over `before` / `after` as defence in depth and normalizes the
 * Mongoose `Map` snapshots into plain objects. No password / hash / token / OTP / session
 * secret can appear in the DTO.
 */

export const ADMIN_AUDIT_LIST_DEFAULT_LIMIT = 25;
export const ADMIN_AUDIT_LIST_MAX_LIMIT = 100;

export type AdminAuditLogDTO = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorAdminId: string;
  subjectUserId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
};

type AuditRow = {
  _id: Types.ObjectId;
  action: string;
  entityType: string;
  entityId?: Types.ObjectId | null;
  actorAdminId: Types.ObjectId;
  subjectUserId?: Types.ObjectId | null;
  before?: unknown;
  after?: unknown;
  createdAt: Date;
};

/** A lean read of a `Map`-typed path comes back as a plain object already; normalize either shape. */
function snapshotToObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  const plain = value instanceof Map ? Object.fromEntries(value) : value;
  if (typeof plain !== "object") return null;
  return redactAuditSnapshot(plain) as Record<string, unknown>;
}

export function toAdminAuditLogDTO(row: AuditRow): AdminAuditLogDTO {
  return {
    id: row._id.toString(),
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId ? row.entityId.toString() : null,
    actorAdminId: row.actorAdminId.toString(),
    subjectUserId: row.subjectUserId ? row.subjectUserId.toString() : null,
    before: snapshotToObject(row.before),
    after: snapshotToObject(row.after),
    createdAt: row.createdAt.toISOString(),
  };
}

export type ListAuditLogsOptions = {
  action?: string;
  actorAdminId?: string;
  subjectUserId?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  cursor?: string;
};

export type AdminAuditLogsPage = { logs: AdminAuditLogDTO[]; nextCursor: string | null };

export async function listAuditLogs(options: ListAuditLogsOptions = {}): Promise<AdminAuditLogsPage> {
  const limit = clampLimit(options.limit, ADMIN_AUDIT_LIST_DEFAULT_LIMIT, ADMIN_AUDIT_LIST_MAX_LIMIT);

  const filter: QueryFilter<AuditRow> = {};
  if (options.action) filter.action = options.action;
  if (options.entityType) filter.entityType = options.entityType;
  if (options.actorAdminId) filter.actorAdminId = new Types.ObjectId(options.actorAdminId);
  if (options.subjectUserId) filter.subjectUserId = new Types.ObjectId(options.subjectUserId);

  const and: Record<string, unknown>[] = [];
  const createdAt: Record<string, Date> = {};
  if (options.dateFrom) createdAt.$gte = new Date(options.dateFrom);
  if (options.dateTo) createdAt.$lte = new Date(options.dateTo);
  if (Object.keys(createdAt).length) and.push({ createdAt });
  if (options.cursor) and.push({ $or: olderThan("createdAt", decodeCursor(options.cursor)) });
  if (and.length) filter.$and = and;

  const rows = await AuditLog.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<AuditRow[]>();

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeCursor(last.createdAt, last._id) : null;

  return { logs: page.map(toAdminAuditLogDTO), nextCursor };
}
