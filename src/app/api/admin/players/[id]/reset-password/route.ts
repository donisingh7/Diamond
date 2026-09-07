import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { resetPlayerPasswordSchema } from "@/modules/admin/validators/admin-player-input";
import { resetPlayerPassword } from "@/modules/admin/services/admin-player.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/players/[id]/reset-password — ADMIN sets a new PLAYER password. ADMIN only,
 * same-origin. The password is hashed; the hash is never returned. Every existing session is
 * revoked in the same transaction, so the player must sign in again with the new credential.
 * Audit `PLAYER_PASSWORD_RESET` (no password material). Not a player self-service flow. An
 * ADMIN / missing / malformed id is `404 PLAYER_NOT_FOUND`.
 */
export const POST = apiRoute(async (request: NextRequest, ctx: RouteContext<"/api/admin/players/[id]/reset-password">) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = resetPlayerPasswordSchema.parse(await request.json());
  await resetPlayerPassword({ actorAdminId: admin._id, playerId: id, newPassword: body.newPassword });
  return NextResponse.json({ data: { reset: true, serverNow: new Date().toISOString() } });
});
