import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { declareResultSchema } from "@/modules/admin/validators/admin-ops-input";
import { confirmResultDeclaration } from "@/modules/admin/services/admin-result.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/results/declare — ADMIN only, same-origin. STEP 2 of the two-step result
 * declaration. Body `.strict()`
 * `{ marketId, businessDate?, result: "00".."99", confirm: true, clientRequestId: uuid }` —
 * `confirm` MUST be the literal `true`.
 *
 * Atomically writes `marketRounds.result` + `resultDeclaredAt` + `declaredByAdminId` + a
 * `RESULT_DECLARED` audit row. It does NOT settle: no bet status change, no `WIN_CREDIT`, no
 * wallet movement, `settlementStatus` stays `PENDING`. An exact replay of the same
 * `(round, clientRequestId, result)` returns the original declaration; a round that already has
 * a result is `409 RESULT_ALREADY_DECLARED`; a conflicting request-id reuse is
 * `409 DUPLICATE_REQUEST`; declaring before close is `422 RESULT_TOO_EARLY`.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const body = declareResultSchema.parse(await request.json());
  const result = await confirmResultDeclaration({
    actorAdminId: admin._id,
    marketId: body.marketId,
    businessDate: body.businessDate,
    result: body.result,
    clientRequestId: body.clientRequestId,
  });
  return NextResponse.json({ data: { result } });
});
