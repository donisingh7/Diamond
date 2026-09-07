import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { getBetDetailForAdmin } from "@/modules/admin/services/admin-bet.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/bets/[id] — ADMIN only, READ ONLY. One bet by 24-hex `_id` or human
 * `publicRef`, with the multiplier snapshot, selections, totals, status and the full revision
 * history (oldest first). A missing / malformed handle is `404 BET_NOT_FOUND`. There is no
 * admin path to edit / delete a bet or mutate a revision.
 */
export const GET = apiRoute(
  async (_request: NextRequest, ctx: RouteContext<"/api/admin/bets/[id]">) => {
    await requireAdmin();
    const { id } = await ctx.params;
    const now = new Date();
    const bet = await getBetDetailForAdmin(id, now);
    return NextResponse.json({ data: { bet, serverNow: now.toISOString() } });
  },
);
