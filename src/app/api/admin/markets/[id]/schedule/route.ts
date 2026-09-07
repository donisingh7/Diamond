import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { updateMarketScheduleSchema } from "@/modules/admin/validators/admin-ops-input";
import { updateMarketSchedule } from "@/modules/admin/services/admin-market.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/markets/[id]/schedule — ADMIN only, same-origin. Body `.strict()`
 * `{ openTime?: "HH:MM", closeTime?: "HH:MM", closeDayOffset?: 0|1, editLockMinutesBeforeClose?: int }`
 * (at least one field). The supplied fields are merged onto the current schedule and the result
 * is validated (ordering, ranges, cross-midnight, edit lock inside the round). The change
 * applies to FUTURE newly-created rounds only — existing persisted `marketRounds`
 * (`opensAt` / `editCutoffAt` / `closesAt`) are NEVER rewritten. Writes `MARKET_SCHEDULE_UPDATED`
 * with safe before/after snapshots. An invalid resulting schedule is `400 INVALID_INPUT`.
 */
export const POST = apiRoute(
  async (request: NextRequest, ctx: RouteContext<"/api/admin/markets/[id]/schedule">) => {
    if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = updateMarketScheduleSchema.parse(await request.json());
    const market = await updateMarketSchedule({ actorAdminId: admin._id, marketId: id, ...body });
    return NextResponse.json({ data: { market, serverNow: new Date().toISOString() } });
  },
);
