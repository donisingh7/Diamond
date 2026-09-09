import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { rejectDepositSchema } from "@/modules/payments/validators/payment-input";
import { rejectDepositRequest } from "@/modules/payments/services/deposit-request.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/deposits/[id]/reject — ADMIN only, same-origin. Body `.strict()`
 * `{ adminRemark, clientRequestId }` — `adminRemark` is REQUIRED. Only a PENDING request
 * transitions (`409 DEPOSIT_NOT_PENDING` otherwise). PENDING → REJECTED with NO wallet
 * movement, plus a `DEPOSIT_REJECTED` audit row. A rejected request can never later credit.
 */
export const POST = apiRoute(async (request: NextRequest, ctx: RouteContext<"/api/admin/deposits/[id]/reject">) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = rejectDepositSchema.parse(await request.json());
  const deposit = await rejectDepositRequest({ actorAdminId: admin._id, depositRequestId: id, adminRemark: body.adminRemark });
  return NextResponse.json({ data: { deposit, serverNow: new Date().toISOString() } });
});
