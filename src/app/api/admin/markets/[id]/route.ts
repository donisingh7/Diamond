import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { getMarketForAdmin } from "@/modules/admin/services/admin-market.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/markets/[id] — ADMIN only. One market's full config + current lifecycle +
 * current-round snapshot. `[id]` is the 24-hex market id; a missing / malformed id is
 * `404 MARKET_NOT_FOUND`.
 */
export const GET = apiRoute(
  async (_request: NextRequest, ctx: RouteContext<"/api/admin/markets/[id]">) => {
    await requireAdmin();
    const { id } = await ctx.params;
    const now = new Date();
    const market = await getMarketForAdmin(id, now);
    return NextResponse.json({ data: { market, serverNow: now.toISOString() } });
  },
);
