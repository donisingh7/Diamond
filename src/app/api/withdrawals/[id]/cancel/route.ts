import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requirePlayer } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { cancelWithdrawalSchema } from "@/modules/withdrawals/validators/withdrawal-input";
import { cancelWithdrawal } from "@/modules/withdrawals/services/withdrawal.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/withdrawals/[id]/cancel — the player cancels their own PENDING withdrawal
 * (`PENDING → CANCELLED`), atomically releasing the reserved funds back to available with one
 * `WITHDRAWAL_RELEASED` ledger row. ACTIVE PLAYER only; owner-only (`404 WITHDRAWAL_NOT_FOUND`
 * otherwise). As a state-changing POST it requires a trusted `Origin` (`403` on mismatch).
 *
 * Safe to retry: an already-CANCELLED withdrawal returns its DTO with no second release; an
 * APPROVED / REJECTED one is `409 WITHDRAWAL_NOT_PENDING`. No request body (`.strict()` — a stray
 * field is `400`).
 */
export const POST = apiRoute(async (request: NextRequest, ctx: RouteContext<"/api/withdrawals/[id]/cancel">) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const user = await requirePlayer();
  const { id } = await ctx.params;
  cancelWithdrawalSchema.parse(await readOptionalJson(request));
  const receipt = await cancelWithdrawal({ userId: user._id, withdrawalId: id });
  return NextResponse.json({ data: receipt });
});

/** A cancel needs no body; tolerate an absent or empty one, still reject a non-empty stray payload. */
async function readOptionalJson(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}
