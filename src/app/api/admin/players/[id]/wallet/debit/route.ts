import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { adminWalletAdjustmentSchema } from "@/modules/admin/validators/admin-player-input";
import { adminDebitWallet } from "@/modules/admin/services/admin-wallet.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/players/[id]/wallet/debit — manual correction / reversal of an accidental
 * credit. ADMIN only, same-origin. Records an immutable `ADMIN_DEBIT` + an `ADMIN_WALLET_DEBIT`
 * audit, atomically. `available -= amount`, never below zero (`422 INSUFFICIENT_BALANCE`);
 * `reserved` is never touched. The earlier ledger row is never edited — this is a new
 * compensating entry.
 *
 * Body `{ amountPaise, reason, paymentReference?, clientRequestId }`. Same idempotency contract
 * as credit. An ADMIN / missing id is `404 PLAYER_NOT_FOUND`.
 */
export const POST = apiRoute(
  async (request: NextRequest, ctx: RouteContext<"/api/admin/players/[id]/wallet/debit">) => {
    if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = adminWalletAdjustmentSchema.parse(await request.json());
    const result = await adminDebitWallet({ actorAdminId: admin._id, playerId: id, ...body });
    return NextResponse.json({ data: result });
  },
);
