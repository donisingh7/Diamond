import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requirePlayer } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { playerDepositsQuerySchema, submitDepositSchema } from "@/modules/payments/validators/payment-input";
import {
  listPlayerDepositRequests,
  submitDepositRequest,
} from "@/modules/payments/services/deposit-request.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/deposits — ACTIVE PLAYER only, same-origin. Body `.strict()`
 * `{ paymentMethodId, requestedAmountPaise, utr, proofImageId, clientRequestId }`. Creates a
 * PENDING DepositRequest with a frozen payment-method snapshot. The method must be ACTIVE, the
 * proof must be the caller's own upload, `requestedAmountPaise > 0`, and the UTR unique across
 * all requests (`409 DUPLICATE_UTR`). Retry-safe: the same `clientRequestId` returns the
 * original request with no second row.
 *
 * GET /api/deposits — the caller's own deposit requests, newest first, bounded, optional
 * `status` filter, opaque cursor.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const user = await requirePlayer();
  const body = submitDepositSchema.parse(await request.json());
  const deposit = await submitDepositRequest({ userId: user._id, request: body });
  return NextResponse.json({ data: { deposit, serverNow: new Date().toISOString() } });
});

export const GET = apiRoute(async (request: NextRequest) => {
  const user = await requirePlayer();
  const query = playerDepositsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const page = await listPlayerDepositRequests(user._id, query);
  return NextResponse.json({ data: { ...page, serverNow: new Date().toISOString() } });
});
