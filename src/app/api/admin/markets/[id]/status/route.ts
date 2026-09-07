import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { setMarketStatusSchema } from "@/modules/admin/validators/admin-ops-input";
import { setMarketEnabled } from "@/modules/admin/services/admin-market.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/markets/[id]/status — ADMIN only, same-origin. Body `.strict()`
 * `{ enabled: boolean }`. Emergency-disable takes effect immediately through the existing
 * server-authoritative betting checks (a disabled market blocks new bets). Historical
 * `marketRounds` are NOT mutated. Writes `MARKET_ENABLED` / `MARKET_DISABLED`; setting the
 * state the market is already in is an idempotent no-op with no second audit row.
 */
export const POST = apiRoute(
  async (request: NextRequest, ctx: RouteContext<"/api/admin/markets/[id]/status">) => {
    if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = setMarketStatusSchema.parse(await request.json());
    const market = await setMarketEnabled({ actorAdminId: admin._id, marketId: id, enabled: body.enabled });
    return NextResponse.json({ data: { market, serverNow: new Date().toISOString() } });
  },
);
