import { Schema } from "mongoose";
import { modelFor, createdOnlyOptions, userRef, optionalUserRef, requiredText } from "@/lib/db/schema";

/** Services must allowlist/redact snapshots and always tag player data with subjectUserId. */
export const auditLogSchema = new Schema({
  actorAdminId: userRef,
  action: requiredText,
  entityType: requiredText,
  entityId: Schema.Types.ObjectId,
  subjectUserId: optionalUserRef,
  before: { type: Map, of: Schema.Types.Mixed },
  after: { type: Map, of: Schema.Types.Mixed },
}, createdOnlyOptions);
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorAdminId: 1, createdAt: -1 });
auditLogSchema.index({ subjectUserId: 1 });
export const AuditLog = modelFor("AuditLog", auditLogSchema, "auditLogs");
