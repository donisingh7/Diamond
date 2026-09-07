import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { getPlayerWalletView } from "@/modules/admin/services/admin-player.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/players/[id]/wallet — ADMIN only. A player's wallet balances: available,
 * reserved, derived total, currency. A ₹0 wallet is created on the fly if the player has none
 * (never grants funds). Ledger history is the sibling `/wallet/transactions` route. An ADMIN /
 * missing / malformed id is `404 PLAYER_NOT_FOUND`.
 */
export const GET = apiRoute(async (_request: NextRequest, ctx: RouteContext<"/api/admin/players/[id]/wallet">) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const wallet = await getPlayerWalletView(id);
  return NextResponse.json({ data: { wallet, serverNow: new Date().toISOString() } });
});
