import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requirePlayer } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { placeBetRequestSchema } from "@/modules/betting/validators/place-bet-input";
import { placeBet } from "@/modules/betting/services/bet-placement.service";

// Reads the session cookie and the database on every call; nothing here is cacheable.
export const dynamic = "force-dynamic";

/**
 * POST /api/bets — confirm a real bet. ACTIVE PLAYER only (an ADMIN session is `403 FORBIDDEN`,
 * an anonymous one `401 UNAUTHENTICATED` — the PLAYER-only boundary is not widened). As a
 * state-changing POST it requires a trusted `Origin` (`403` on mismatch), matching the auth
 * and quote mutation routes. The bet owner is the authenticated session — no `userId` is
 * accepted from the client.
 *
 * Discriminated, `.strict()` Zod body (`400 INVALID_INPUT` on failure). All authoritative
 * values — totals, selection count, payout multiplier, round id, public reference, wallet
 * balance — are server-derived; a prior quote is not trusted. The placement service owns the
 * atomic Bet + wallet debit + `BET_PLACED` ledger transaction and the `clientRequestId`
 * idempotency.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const user = await requirePlayer();
  const body = placeBetRequestSchema.parse(await request.json());
  const receipt = await placeBet({ userId: user._id, request: body });
  return NextResponse.json({ data: receipt });
});
