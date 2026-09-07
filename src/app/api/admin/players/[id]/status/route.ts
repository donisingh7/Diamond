import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { setPlayerStatusSchema } from "@/modules/admin/validators/admin-player-input";
import { setPlayerStatus } from "@/modules/admin/services/admin-player.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/players/[id]/status — enable / disable a PLAYER. ADMIN only, same-origin.
 * Body `{ status: "ACTIVE" | "DISABLED" }`.
 *
 *  - DISABLED: `ACTIVE → DISABLED`, every session revoked in the same transaction, audit
 *    `PLAYER_DISABLED`. Historical data kept; user not deleted. Repeat is a safe no-op.
 *  - ACTIVE:   `DISABLED → ACTIVE`, audit `PLAYER_ENABLED`. Old sessions are NOT recreated —
 *    the player must log in again. Repeat is a safe no-op.
 *
 * An ADMIN / missing / malformed id is `404 PLAYER_NOT_FOUND`.
 */
export const POST = apiRoute(async (request: NextRequest, ctx: RouteContext<"/api/admin/players/[id]/status">) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = setPlayerStatusSchema.parse(await request.json());
  const player = await setPlayerStatus({ actorAdminId: admin._id, playerId: id, status: body.status });
  return NextResponse.json({ data: { player, serverNow: new Date().toISOString() } });
});
