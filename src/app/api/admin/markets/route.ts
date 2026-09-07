import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { adminMarketsListQuerySchema } from "@/modules/admin/validators/admin-ops-input";
import { listMarketsForAdmin } from "@/modules/admin/services/admin-market.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/markets — ADMIN only. Every market with its config (schedule in `HH:MM` and
 * minutes, `closeDayOffset`, `editLockMinutesBeforeClose`), `enabled`, server-derived lifecycle
 * state and current-round snapshot. Optional `?enabled=true|false`. `serverNow` is included so
 * the UI never trusts the client clock.
 */
export const GET = apiRoute(async (request: NextRequest) => {
  await requireAdmin();
  const query = adminMarketsListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const now = new Date();
  const { markets } = await listMarketsForAdmin(
    { enabled: query.enabled === undefined ? undefined : query.enabled === "true" },
    now,
  );
  return NextResponse.json({ data: { markets, serverNow: now.toISOString() } });
});
