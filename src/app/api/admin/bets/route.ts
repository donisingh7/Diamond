import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { adminBetsListQuerySchema } from "@/modules/admin/validators/admin-ops-input";
import { listBetsForAdmin } from "@/modules/admin/services/admin-bet.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/bets — ADMIN only, READ ONLY. Every bet, newest first, bounded (`?limit=` 1–50
 * default 20, `?cursor=` opaque). Filters: `?playerId=`, `?market=<slug>`, `?status=`,
 * `?entryMethod=`, `?businessDate=YYYY-MM-DD`, `?dateFrom=` / `?dateTo=` on `createdAt`. Each row
 * reuses the sanitized player bet DTO plus a player summary. There is NO admin bet mutation
 * anywhere. Anonymous → `401`, PLAYER → `403`; an unknown `?market` is `404 MARKET_NOT_FOUND`.
 */
export const GET = apiRoute(async (request: NextRequest) => {
  await requireAdmin();
  const query = adminBetsListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const now = new Date();
  const page = await listBetsForAdmin(query, now);
  return NextResponse.json({ data: { ...page, serverNow: now.toISOString() } });
});
