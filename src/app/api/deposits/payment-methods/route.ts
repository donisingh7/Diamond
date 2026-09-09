import "server-only";
import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requirePlayer } from "@/lib/auth/session";
import { listActivePaymentMethodsForPlayer } from "@/modules/payments/services/payment-method.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/deposits/payment-methods — ACTIVE PLAYER only. The payment destinations a player can
 * pay to right now, in display order, with the full coordinates (UPI id / bank details / QR
 * image id) needed to actually make the transfer. Inactive methods are never listed.
 */
export const GET = apiRoute(async () => {
  await requirePlayer();
  const paymentMethods = await listActivePaymentMethodsForPlayer();
  return NextResponse.json({ data: { paymentMethods, serverNow: new Date().toISOString() } });
});
