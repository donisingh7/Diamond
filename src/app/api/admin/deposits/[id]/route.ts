import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { getDepositRequestForAdmin } from "@/modules/payments/services/deposit-request.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/deposits/[id] — ADMIN only. Full deposit-request detail including the frozen
 * payment-method snapshot, the player id, the raw UTR and the proof image id. A missing id is
 * `404 DEPOSIT_REQUEST_NOT_FOUND`.
 */
export const GET = apiRoute(async (_request: NextRequest, ctx: RouteContext<"/api/admin/deposits/[id]">) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const deposit = await getDepositRequestForAdmin(id);
  return NextResponse.json({ data: { deposit, serverNow: new Date().toISOString() } });
});
