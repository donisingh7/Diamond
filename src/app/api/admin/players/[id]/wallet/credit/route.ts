import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { adminWalletAdjustmentSchema } from "@/modules/admin/validators/admin-player-input";
import { adminCreditWallet } from "@/modules/admin/services/admin-wallet.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/players/[id]/wallet/credit — the LOCKED V1 manual deposit. ADMIN only,
 * same-origin. The player paid the admin OUTSIDE Diamond; the admin verified it; this credits
 * the Diamond wallet and records an immutable `ADMIN_CREDIT` + an `ADMIN_WALLET_CREDIT` audit,
 * atomically. There is NO payment gateway.
 *
 * Body `{ amountPaise, reason, paymentReference?, clientRequestId }`. `amountPaise` ≥ ₹1 whole
 * paise; `reason` REQUIRED; the resulting balance is computed by the server, never accepted.
 * Idempotent on `(admin, clientRequestId)` — an exact replay returns the original receipt; a
 * conflicting reuse is `409 DUPLICATE_REQUEST`. An ADMIN / missing id is `404 PLAYER_NOT_FOUND`.
 */
export const POST = apiRoute(
  async (request: NextRequest, ctx: RouteContext<"/api/admin/players/[id]/wallet/credit">) => {
    if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = adminWalletAdjustmentSchema.parse(await request.json());
    const result = await adminCreditWallet({ actorAdminId: admin._id, playerId: id, ...body });
    return NextResponse.json({ data: result });
  },
);
