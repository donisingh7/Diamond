import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requirePlayer } from "@/lib/auth/session";
import { resultsQuerySchema } from "@/modules/markets/validators/market-query";
import { getMarketBySlug } from "@/modules/markets/services/market.service";
import { getCurrentResults, getResultHistory } from "@/modules/markets/services/result.service";

export const dynamic = "force-dynamic";

/**
 * ACTIVE PLAYER only. `?range=today|7d|30d` (default today) and optional `?market=<slug>`.
 * Zod rejects an unknown range or stray params (400); an unknown market slug is 404.
 * `today` returns each market's current operational round (result may be null / pending);
 * `7d`/`30d` return only persisted result-bearing rounds inside the IST window.
 */
export const GET = apiRoute(async (request: NextRequest) => {
  await requirePlayer();
  const query = resultsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const now = new Date();

  if (query.range === "today") {
    const all = await getCurrentResults(now);
    const results = query.market ? all.filter((entry) => entry.slug === query.market) : all;
    if (query.market && results.length === 0) await getMarketBySlug(query.market); // → 404 if the slug is unknown
    return NextResponse.json({ data: { range: query.range, results, serverNow: now.toISOString() } });
  }

  const results = await getResultHistory(query.range, now, query.market);
  return NextResponse.json({ data: { range: query.range, results, serverNow: now.toISOString() } });
});
