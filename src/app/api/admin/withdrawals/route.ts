import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { adminWithdrawalsListQuerySchema } from "@/modules/admin/validators/admin-ops-input";
import { listWithdrawalsForAdmin } from "@/modules/admin/services/admin-withdrawal.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/withdrawals — ADMIN only. Global withdrawal list, newest requested first,
 * bounded (`?limit=` 1–100 default 25, `?cursor=` opaque). Filters: `?status=`, `?method=`,
 * `?search=` (player loginId / email substring, exact phone), `?dateFrom=` / `?dateTo=` on
 * `requestedAt`. Anonymous → `401`, PLAYER → `403`. List rows carry only a MASKED destination —
 * no raw bank / UPI details.
 */
export const GET = apiRoute(async (request: NextRequest) => {
  await requireAdmin();
  const query = adminWithdrawalsListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const page = await listWithdrawalsForAdmin(query);
  return NextResponse.json({ data: { ...page, serverNow: new Date().toISOString() } });
});
