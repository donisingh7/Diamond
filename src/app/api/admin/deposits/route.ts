import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { adminDepositsQuerySchema } from "@/modules/payments/validators/payment-input";
import { listDepositRequestsForAdmin } from "@/modules/payments/services/deposit-request.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/deposits — ADMIN only. Every deposit request, newest submitted first, bounded,
 * opaque `(submittedAt, _id)` cursor. Optional `status` and `userId` filters.
 */
export const GET = apiRoute(async (request: NextRequest) => {
  await requireAdmin();
  const query = adminDepositsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const page = await listDepositRequestsForAdmin(query);
  return NextResponse.json({ data: { ...page, serverNow: new Date().toISOString() } });
});
