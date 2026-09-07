import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { getPlayerDetail } from "@/modules/admin/services/admin-player.service";
import { purgePlayerById } from "@/modules/admin/services/player-deletion.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/players/[id] — ADMIN only. Sanitized identity + live wallet (available /
 * reserved / total / currency). A missing id, a malformed id and an ADMIN id are all an
 * indistinguishable `404 PLAYER_NOT_FOUND`. Linked data (ledger, bets, withdrawals) has its own
 * dedicated sub-routes rather than one composite payload.
 */
export const GET = apiRoute(async (_request: NextRequest, ctx: RouteContext<"/api/admin/players/[id]">) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const player = await getPlayerDetail(id);
  return NextResponse.json({ data: { player, serverNow: new Date().toISOString() } });
});

/**
 * DELETE /api/admin/players/[id] — hard purge (brief §15). ADMIN only, same-origin required.
 * Removes the user and EVERY piece of application data that identifies them (sessions, OTP,
 * wallet, ledger, bets, revisions, withdrawals, identifying audit rows) in one transaction, then
 * writes a single non-identifying `PLAYER_DELETION_COMPLETED` audit row. ADMIN targets are
 * `404 PLAYER_NOT_FOUND` — never purgeable here. Not a soft delete: no tombstone, no deny-list.
 */
export const DELETE = apiRoute(async (request: NextRequest, ctx: RouteContext<"/api/admin/players/[id]">) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  await purgePlayerById(admin._id, id);
  return NextResponse.json({ data: { purged: true, serverNow: new Date().toISOString() } });
});
