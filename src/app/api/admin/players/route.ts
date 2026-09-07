import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { createPlayerSchema, listPlayersQuerySchema } from "@/modules/admin/validators/admin-player-input";
import { createPlayer, listPlayers } from "@/modules/admin/services/admin-player.service";

// Reads the session cookie and the database on every call; nothing here is cacheable.
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/players — ADMIN only. PLAYER accounts, newest first, bounded (`?limit=` 1–100
 * default 25, `?cursor=` opaque). Optional `?search=` (normalized loginId / email substring,
 * exact phone) and `?status=ACTIVE|DISABLED`. An anonymous request is `401`, a PLAYER session
 * `403`. No `passwordHash` / session / OTP material is ever serialized.
 */
export const GET = apiRoute(async (request: NextRequest) => {
  await requireAdmin();
  const query = listPlayersQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const page = await listPlayers(query);
  return NextResponse.json({ data: { ...page, serverNow: new Date().toISOString() } });
});

/**
 * POST /api/admin/players — create a PLAYER (+ its ₹0 wallet + a `PLAYER_CREATED` audit) in one
 * transaction. ADMIN only, same-origin required. Role is server-forced PLAYER — the strict body
 * has no `role` field. No opening balance (a real one is a separate `ADMIN_CREDIT`). A taken
 * `loginId` is `409 LOGIN_ID_TAKEN`; a taken phone / email is `409 IDENTIFIER_TAKEN`.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const body = createPlayerSchema.parse(await request.json());
  const player = await createPlayer({ actorAdminId: admin._id, ...body });
  return NextResponse.json({ data: { player, serverNow: new Date().toISOString() } }, { status: 201 });
});
