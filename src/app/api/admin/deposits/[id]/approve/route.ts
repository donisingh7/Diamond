import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { approveDepositSchema } from "@/modules/payments/validators/payment-input";
import { approveDepositRequest } from "@/modules/payments/services/deposit-request.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/deposits/[id]/approve — ADMIN only, same-origin. Body `.strict()`
 * `{ approvedAmountPaise, adminRemark?, clientRequestId }`. Only a PENDING request transitions
 * (`409 DEPOSIT_NOT_PENDING` otherwise). `approvedAmountPaise` MAY be lower or higher than the
 * requested amount; when it differs, `adminRemark` is REQUIRED. The original
 * `requestedAmountPaise` is never overwritten. In one transaction: PENDING → APPROVED + a
 * single `DEPOSIT_CREDIT` wallet credit (idempotent per request) + a `DEPOSIT_APPROVED` audit
 * row. A double-click / concurrent call credits at most once.
 */
export const POST = apiRoute(async (request: NextRequest, ctx: RouteContext<"/api/admin/deposits/[id]/approve">) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = approveDepositSchema.parse(await request.json());
  const deposit = await approveDepositRequest({
    actorAdminId: admin._id,
    depositRequestId: id,
    approvedAmountPaise: body.approvedAmountPaise,
    adminRemark: body.adminRemark,
  });
  return NextResponse.json({ data: { deposit, serverNow: new Date().toISOString() } });
});
