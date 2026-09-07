import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { settleRoundSchema } from "@/modules/admin/validators/admin-ops-input";
import { settleDeclaredRound } from "@/modules/admin/services/admin-settlement.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/results/settle — ADMIN only, same-origin. The settlement step of the
 * round-outcome lifecycle, after `results/prepare` + `results/declare`: runs settlement of ONE
 * already-declared `MarketRound` via the Window 7A1 `settleRound()` engine and returns its
 * summary.
 *
 * Body `.strict()` `{ marketId, businessDate?, confirm: true, clientRequestId: uuid }` —
 * `confirm` MUST be literal `true`. There is deliberately NO `result` field: this route settles
 * against the number Window 6A2 recorded and cannot declare or change one.
 *
 * An exact replay / already-settled round is safe: it returns the stored settled summary
 * (`alreadySettled: true`, `auditWritten: false`) with no wallet movement and no second audit
 * row. Unknown round → `404 ROUND_NOT_FOUND`; a round with no declared result →
 * `422 RESULT_NOT_DECLARED`.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const body = settleRoundSchema.parse(await request.json());
  const settlement = await settleDeclaredRound({
    actorAdminId: admin._id,
    marketId: body.marketId,
    businessDate: body.businessDate,
  });
  return NextResponse.json({ data: { settlement } });
});
