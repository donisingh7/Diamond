import "server-only";
import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/session";
import { getAdminDashboard } from "@/modules/admin/services/admin-dashboard.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/dashboard — ADMIN only. Server-calculated operational summary for a future
 * Window 6B dashboard: active / disabled player counts, total available + reserved wallet
 * balances, pending withdrawal count + amount, today's (IST) bet count + stake, per-market
 * lifecycle status, results pending / declared counts, and recent admin activity. Every value
 * is a real aggregate — nothing is fabricated. Anonymous → `401`, PLAYER → `403`.
 */
export const GET = apiRoute(async () => {
  await requireAdmin();
  return NextResponse.json({ data: await getAdminDashboard() });
});
