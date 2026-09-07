import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { adminAuditListQuerySchema } from "@/modules/admin/validators/admin-ops-input";
import { listAuditLogs } from "@/modules/admin/services/admin-audit.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit — ADMIN only. Bounded, newest-first `auditLogs` browser (`?limit=` 1–100
 * default 25, `?cursor=` opaque). Filters: `?action=`, `?actorAdminId=`, `?subjectUserId=`,
 * `?entityType=`, `?dateFrom=` / `?dateTo=` on `createdAt`. Rows are sanitized — `before` /
 * `after` are re-redacted on read, so no password / hash / token / OTP / session secret can
 * appear. Anonymous → `401`, PLAYER → `403`.
 */
export const GET = apiRoute(async (request: NextRequest) => {
  await requireAdmin();
  const query = adminAuditListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const page = await listAuditLogs(query);
  return NextResponse.json({ data: { ...page, serverNow: new Date().toISOString() } });
});
