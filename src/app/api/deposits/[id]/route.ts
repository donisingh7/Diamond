import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requirePlayer } from "@/lib/auth/session";
import { getPlayerDepositRequest } from "@/modules/payments/services/deposit-request.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/deposits/[id] — one of the caller's own deposit requests. A missing OR non-owned id
 * is an indistinguishable `404 DEPOSIT_REQUEST_NOT_FOUND`.
 */
export const GET = apiRoute(async (_request: NextRequest, ctx: RouteContext<"/api/deposits/[id]">) => {
  const user = await requirePlayer();
  const { id } = await ctx.params;
  const deposit = await getPlayerDepositRequest(user._id, id);
  return NextResponse.json({ data: { deposit, serverNow: new Date().toISOString() } });
});
