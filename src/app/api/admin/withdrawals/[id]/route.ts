import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { getWithdrawalDetailForAdmin } from "@/modules/admin/services/admin-withdrawal.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/withdrawals/[id] — ADMIN only. The full withdrawal detail, INCLUDING the raw
 * BANK / UPI `payoutDestination` the admin needs to make the real out-of-Diamond transfer. This
 * is the ONLY endpoint that returns that sensitive data — it is never in a list DTO, an audit
 * row, an error, or a log. A missing / malformed id is `404 WITHDRAWAL_NOT_FOUND`.
 */
export const GET = apiRoute(
  async (_request: NextRequest, ctx: RouteContext<"/api/admin/withdrawals/[id]">) => {
    await requireAdmin();
    const { id } = await ctx.params;
    const withdrawal = await getWithdrawalDetailForAdmin(id);
    return NextResponse.json({ data: { withdrawal, serverNow: new Date().toISOString() } });
  },
);
