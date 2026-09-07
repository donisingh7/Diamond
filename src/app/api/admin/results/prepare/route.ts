import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { prepareResultSchema } from "@/modules/admin/validators/admin-ops-input";
import { prepareResultDeclaration } from "@/modules/admin/services/admin-result.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/results/prepare — ADMIN only, same-origin. STEP 1 of the two-step result
 * declaration: validates admin / market / round / closed-state / result syntax and returns a
 * sanitized preview with an explicit "settlement has NOT occurred" warning. NO mutation.
 *
 * Body `.strict()` `{ marketId: hex24, businessDate?: "YYYY-MM-DD", result: "00".."99" }`.
 * `result` is a two-character STRING (leading zeros preserved). Declaring before
 * `now >= closesAt` is `422 RESULT_TOO_EARLY`. This is a `POST` (not a `GET`) because it names a
 * proposed mutation, but it writes nothing.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  await requireAdmin();
  const body = prepareResultSchema.parse(await request.json());
  const preview = await prepareResultDeclaration(body);
  return NextResponse.json({ data: { preview } });
});
