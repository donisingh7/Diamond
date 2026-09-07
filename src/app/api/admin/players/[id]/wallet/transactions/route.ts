import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { adminWalletTransactionsQuerySchema } from "@/modules/admin/validators/admin-player-input";
import { listPlayerWalletTransactionsForAdmin } from "@/modules/admin/services/admin-wallet.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/players/[id]/wallet/transactions — ADMIN only. A player's immutable ledger,
 * newest first, bounded (`?limit=` 1–100 default 20, `?cursor=` opaque). Rows carry the admin
 * operational metadata (`reason`, `paymentReference`, `actorAdminId`) but NEVER the internal
 * `idempotencyKey`. An ADMIN / missing / malformed id is `404 PLAYER_NOT_FOUND`.
 */
export const GET = apiRoute(
  async (request: NextRequest, ctx: RouteContext<"/api/admin/players/[id]/wallet/transactions">) => {
    await requireAdmin();
    const { id } = await ctx.params;
    const query = adminWalletTransactionsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const page = await listPlayerWalletTransactionsForAdmin(id, { limit: query.limit, cursor: query.cursor });
    return NextResponse.json({ data: { ...page, serverNow: new Date().toISOString() } });
  },
);
