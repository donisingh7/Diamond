import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { rejectWithdrawalSchema } from "@/modules/admin/validators/admin-ops-input";
import { rejectWithdrawalOp } from "@/modules/admin/services/admin-withdrawal.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/withdrawals/[id]/reject — ADMIN only, same-origin. Body `.strict()`
 * `{ reason, clientRequestId: uuid, note? }` — a bounded `reason` is REQUIRED. Releases the
 * reserved amount back to available (`reserved -= X`, `available += X`), `PENDING → REJECTED`
 * with the stored reason, one `WITHDRAWAL_RELEASED` ledger row + a `WITHDRAWAL_REJECTED` audit
 * row, atomic. No earlier transaction is edited or deleted. Idempotent on
 * `(withdrawal, clientRequestId)`.
 */
export const POST = apiRoute(
  async (request: NextRequest, ctx: RouteContext<"/api/admin/withdrawals/[id]/reject">) => {
    if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = rejectWithdrawalSchema.parse(await request.json());
    const result = await rejectWithdrawalOp({
      actorAdminId: admin._id,
      withdrawalId: id,
      clientRequestId: body.clientRequestId,
      reason: body.reason,
      note: body.note,
    });
    return NextResponse.json({ data: result });
  },
);
