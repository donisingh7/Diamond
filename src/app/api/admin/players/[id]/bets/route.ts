import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { adminPlayerBetsQuerySchema } from "@/modules/admin/validators/admin-player-input";
import { listPlayerBetsForAdmin } from "@/modules/admin/services/admin-player.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/players/[id]/bets — ADMIN only. A player's bets (with per-bet revision history
 * available through the player detail service), newest first, bounded (`?limit=` 1–50 default
 * 20, `?cursor=` opaque). Optional `?status=ACTIVE|WON|LOST` and `?market=<slug>`. Read-only —
 * there is NO admin bet edit / delete route (brief §23). An ADMIN / missing id is
 * `404 PLAYER_NOT_FOUND`.
 */
export const GET = apiRoute(async (request: NextRequest, ctx: RouteContext<"/api/admin/players/[id]/bets">) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const query = adminPlayerBetsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const now = new Date();
  const page = await listPlayerBetsForAdmin(
    id,
    { limit: query.limit, cursor: query.cursor, status: query.status, market: query.market },
    now,
  );
  return NextResponse.json({ data: { ...page, serverNow: now.toISOString() } });
});
