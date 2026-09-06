import "server-only";
import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requirePlayer } from "@/lib/auth/session";
import { getMarketsWithCurrentRounds } from "@/modules/markets/services/market.service";
import { toMarketDTO } from "@/modules/markets/services/market-dto";

// Reads the session cookie and the database on every call; nothing here is cacheable.
export const dynamic = "force-dynamic";

/** ACTIVE PLAYER only. Every market with its server-resolved current round; `serverNow` lets the UI
 *  correct for client clock skew when it renders countdowns. An ADMIN session is rejected (FORBIDDEN). */
export const GET = apiRoute(async () => {
  await requirePlayer();
  const now = new Date();
  const markets = await getMarketsWithCurrentRounds(now);
  return NextResponse.json({
    data: {
      markets: markets.map(({ market, resolved }) => toMarketDTO(market, resolved)),
      serverNow: now.toISOString(),
    },
  });
});
