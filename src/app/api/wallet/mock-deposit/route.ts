import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requirePlayer } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { mockDepositSchema } from "@/modules/wallet/validators/wallet-input";
import { mockDeposit } from "@/modules/wallet/services/mock-deposit.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/mock-deposit — ACTIVE PLAYER only, same-origin required (state-changing).
 * Prototype credit: no real payment gateway. Immediate, ledgered, idempotent on
 * `clientRequestId`. An ADMIN session is `403` — there is no admin credit path through this
 * player route. Body: `{ amountPaise, clientRequestId }`.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const user = await requirePlayer();
  const body = mockDepositSchema.parse(await request.json());
  const result = await mockDeposit({
    userId: user._id,
    amountPaise: body.amountPaise,
    clientRequestId: body.clientRequestId,
  });
  return NextResponse.json({
    data: { ...result, serverNow: new Date().toISOString() },
  });
});
