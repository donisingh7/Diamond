import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requirePlayer } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { createWithdrawalSchema, withdrawalsListQuerySchema } from "@/modules/withdrawals/validators/withdrawal-input";
import { listPlayerWithdrawals, requestWithdrawal } from "@/modules/withdrawals/services/withdrawal.service";

// Reads the session cookie and the database on every call; nothing here is cacheable.
export const dynamic = "force-dynamic";

/**
 * GET /api/withdrawals — the player's own withdrawals, newest first, bounded (`?limit=` 1–50
 * default 20, `?cursor=` opaque). Optional `?status=PENDING|APPROVED|REJECTED|CANCELLED` filter.
 * ACTIVE PLAYER only; an anonymous request is `401`, an ADMIN session `403` (PLAYER-only, not
 * widened). Identity is the authenticated session — a client `userId` is never accepted. Sensitive
 * bank / UPI details are never serialized; only a pre-masked `destination.summary` is returned.
 */
export const GET = apiRoute(async (request: NextRequest) => {
  const user = await requirePlayer();
  const query = withdrawalsListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const page = await listPlayerWithdrawals(user._id, {
    limit: query.limit,
    cursor: query.cursor,
    status: query.status,
  });
  return NextResponse.json({ data: { ...page, serverNow: new Date().toISOString() } });
});

/**
 * POST /api/withdrawals — request a withdrawal. ACTIVE PLAYER only (an ADMIN session is `403`, an
 * anonymous one `401` — the PLAYER-only boundary is not widened). As a state-changing POST it
 * requires a trusted `Origin` (`403` on mismatch), matching the other mutation routes. The owner
 * is the authenticated session — no `userId` is accepted from the client.
 *
 * Strict, discriminated Zod body (`method: "BANK" | "UPI"`). The duplicated `bank.confirmAccountNumber`
 * must equal `bank.accountNumber` and is never stored. The service owns the atomic
 * available→reserved wallet transfer + PENDING withdrawal + `WITHDRAWAL_RESERVED` ledger row and
 * the `clientRequestId` idempotency.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const user = await requirePlayer();
  const body = createWithdrawalSchema.parse(await request.json());
  const receipt = await requestWithdrawal({ userId: user._id, request: body });
  return NextResponse.json({ data: receipt });
});
