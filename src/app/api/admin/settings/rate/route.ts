import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { updatePayoutRateSchema } from "@/modules/admin/validators/admin-ops-input";
import { getPayoutRate, updatePayoutRate } from "@/modules/admin/services/admin-settings.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/settings/rate — ADMIN only. The current platform payout multiplier + currency
 * + minimum stake + `serverNow`.
 */
export const GET = apiRoute(async () => {
  await requireAdmin();
  return NextResponse.json({ data: await getPayoutRate() });
});

/**
 * POST /api/admin/settings/rate — ADMIN only, same-origin. Body `.strict()`
 * `{ payoutMultiplier: int ≥ 1 }`. Updates the FUTURE payout multiplier and writes a
 * `PAYOUT_RATE_UPDATED` audit row with before/after values. Existing `Bet`
 * `payoutMultiplierSnapshot` values are NEVER changed — only bets placed after this call get the
 * new rate. Setting the rate to its current value is a no-op (`changed: false`, no audit row).
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const body = updatePayoutRateSchema.parse(await request.json());
  const result = await updatePayoutRate({ actorAdminId: admin._id, payoutMultiplier: body.payoutMultiplier });
  return NextResponse.json({ data: result });
});
