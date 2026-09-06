import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requirePlayer } from "@/lib/auth/session";
import { getMarketWithCurrentRound } from "@/modules/markets/services/market.service";
import { toMarketDTO } from "@/modules/markets/services/market-dto";

export const dynamic = "force-dynamic";

/** ACTIVE PLAYER only. Unknown slug → 404 MARKET_NOT_FOUND (thrown by the market service). */
export const GET = apiRoute(async (_request: NextRequest, ctx: RouteContext<"/api/markets/[slug]">) => {
  await requirePlayer();
  const { slug } = await ctx.params;
  const now = new Date();
  const { market, resolved } = await getMarketWithCurrentRound(slug, now);
  return NextResponse.json({ data: { market: toMarketDTO(market, resolved), serverNow: now.toISOString() } });
});
