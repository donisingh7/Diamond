import "server-only";
import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requirePlayer } from "@/lib/auth/session";
import { getWalletView } from "@/modules/wallet/services/wallet.service";

// Reads the session cookie and the database on every call; nothing here is cacheable.
export const dynamic = "force-dynamic";

/**
 * GET /api/wallet — ACTIVE PLAYER only. Returns the player's own wallet (available / reserved
 * separately, plus derived total), identified strictly from the authenticated session — a
 * client-supplied `userId` is never trusted. An anonymous request is `401`; an ADMIN session
 * is `403` (this is a PLAYER-only API and the boundary is not widened).
 */
export const GET = apiRoute(async () => {
  const user = await requirePlayer();
  const wallet = await getWalletView(user._id);
  return NextResponse.json({ data: { wallet, serverNow: new Date().toISOString() } });
});
