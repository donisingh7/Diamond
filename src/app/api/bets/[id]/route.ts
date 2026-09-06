import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requirePlayer } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { getPlayerBetDetail } from "@/modules/betting/services/bet-read.service";
import { editBetRequestSchema } from "@/modules/betting/validators/edit-bet-input";
import { editBet } from "@/modules/betting/services/bet-edit.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/bets/[id] — one of the caller's own bets plus its full revision history, for the
 * ticket / edit screen. `[id]` is the bet's `id` handle (24-hex ObjectId) OR its human
 * `publicRef` (case-insensitive). ACTIVE PLAYER only; a non-owned or missing bet is an
 * indistinguishable `404 BET_NOT_FOUND` — knowing a `publicRef` never grants access.
 */
export const GET = apiRoute(async (_request: NextRequest, ctx: RouteContext<"/api/bets/[id]">) => {
  const user = await requirePlayer();
  const { id } = await ctx.params;
  const now = new Date();
  const bet = await getPlayerBetDetail(user._id, id, now);
  return NextResponse.json({ data: { bet, serverNow: now.toISOString() } });
});

/**
 * PATCH /api/bets/[id] — edit the WHOLE wager of an ACTIVE bet before its round's edit cutoff.
 * ACTIVE PLAYER only; owner-only (`404 BET_NOT_FOUND` otherwise). As a state-changing request it
 * requires a trusted `Origin` (`403` on mismatch), matching the other mutation routes.
 *
 * `.strict()` discriminated body: the method-specific input (`numbers` / `digits` / `rawInput` +
 * `palti`), `stakePaise`, `expectedVersion` (optimistic-concurrency guard) and `editRequestId`
 * (idempotency). No `userId`, no `marketSlug` — an edit cannot re-owner or re-market a bet.
 * Every authoritative value is recomputed server-side; the payout multiplier snapshot is NOT
 * refreshed. Returns the updated bet detail (including the new revision).
 */
export const PATCH = apiRoute(async (request: NextRequest, ctx: RouteContext<"/api/bets/[id]">) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const user = await requirePlayer();
  const { id } = await ctx.params;
  const body = editBetRequestSchema.parse(await request.json());
  const bet = await editBet({ userId: user._id, betRef: id, request: body });
  return NextResponse.json({ data: { bet, serverNow: new Date().toISOString() } });
});
