import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { approveWithdrawalSchema } from "@/modules/admin/validators/admin-ops-input";
import { approveWithdrawalOp } from "@/modules/admin/services/admin-withdrawal.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/withdrawals/[id]/approve — "Mark Paid & Approve". ADMIN only, same-origin.
 * Body `.strict()` `{ confirmPaid: true, clientRequestId: uuid, paymentReference?, note? }` —
 * `confirmPaid` MUST be the literal `true` (the admin is asserting the real payment was made);
 * a body without it fails validation and nothing is approved.
 *
 * Finalizes the reserved amount only (`reserved -= X`, available UNCHANGED — never a second
 * debit), `PENDING → APPROVED`, one immutable `WITHDRAWAL_APPROVED` ledger row + audit row, all
 * atomic. No real bank/UPI transfer happens here. Idempotent on `(withdrawal, clientRequestId)`;
 * a conflicting reuse is `409 DUPLICATE_REQUEST`; a non-PENDING withdrawal is
 * `409 WITHDRAWAL_NOT_PENDING`.
 */
export const POST = apiRoute(
  async (request: NextRequest, ctx: RouteContext<"/api/admin/withdrawals/[id]/approve">) => {
    if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = approveWithdrawalSchema.parse(await request.json());
    const result = await approveWithdrawalOp({
      actorAdminId: admin._id,
      withdrawalId: id,
      clientRequestId: body.clientRequestId,
      paymentReference: body.paymentReference,
      note: body.note,
    });
    return NextResponse.json({ data: result });
  },
);
