import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requirePlayer } from "@/lib/auth/session";
import { getPlayerWithdrawalDetail } from "@/modules/withdrawals/services/withdrawal.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/withdrawals/[id] — one of the caller's own withdrawals. `[id]` is the withdrawal's
 * 24-hex `id` handle (withdrawals have no public reference). ACTIVE PLAYER only; a non-owned or
 * missing withdrawal is an indistinguishable `404 WITHDRAWAL_NOT_FOUND` — knowing an id never
 * grants access. Sensitive bank / UPI details are never serialized (only `destination.summary`).
 */
export const GET = apiRoute(async (_request: NextRequest, ctx: RouteContext<"/api/withdrawals/[id]">) => {
  const user = await requirePlayer();
  const { id } = await ctx.params;
  const withdrawal = await getPlayerWithdrawalDetail(user._id, id);
  return NextResponse.json({ data: { withdrawal, serverNow: new Date().toISOString() } });
});
