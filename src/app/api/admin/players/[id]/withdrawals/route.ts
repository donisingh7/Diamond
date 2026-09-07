import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { adminPlayerWithdrawalsQuerySchema } from "@/modules/admin/validators/admin-player-input";
import { listPlayerWithdrawalsForAdmin } from "@/modules/admin/services/admin-player.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/players/[id]/withdrawals — ADMIN only. A player's withdrawals, newest first,
 * bounded (`?limit=` 1–50 default 20, `?cursor=` opaque). Optional
 * `?status=PENDING|APPROVED|REJECTED|CANCELLED`. Sanitized DTO — only a pre-masked
 * `destination.summary`, never raw bank / UPI details. Approve / reject is Window 6A2, not here.
 * An ADMIN / missing id is `404 PLAYER_NOT_FOUND`.
 */
export const GET = apiRoute(
  async (request: NextRequest, ctx: RouteContext<"/api/admin/players/[id]/withdrawals">) => {
    await requireAdmin();
    const { id } = await ctx.params;
    const query = adminPlayerWithdrawalsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const page = await listPlayerWithdrawalsForAdmin(id, {
      limit: query.limit,
      cursor: query.cursor,
      status: query.status,
    });
    return NextResponse.json({ data: { ...page, serverNow: new Date().toISOString() } });
  },
);
