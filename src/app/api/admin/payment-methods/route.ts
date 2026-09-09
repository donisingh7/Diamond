import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { createPaymentMethodSchema } from "@/modules/payments/validators/payment-input";
import {
  createPaymentMethod,
  listPaymentMethodsForAdmin,
} from "@/modules/payments/services/payment-method.service";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/payment-methods — ADMIN only. Every method, active and inactive, in display
 *      order. Admin account numbers are masked.
 * POST /api/admin/payment-methods — ADMIN only, same-origin. `.strict()` discriminated body on
 *      `type` ("UPI" | "BANK"). Audited `PAYMENT_METHOD_CREATED`.
 */
export const GET = apiRoute(async () => {
  await requireAdmin();
  const paymentMethods = await listPaymentMethodsForAdmin();
  return NextResponse.json({ data: { paymentMethods, serverNow: new Date().toISOString() } });
});

export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const body = createPaymentMethodSchema.parse(await request.json());
  const paymentMethod = await createPaymentMethod({ actorAdminId: admin._id, request: body });
  return NextResponse.json({ data: { paymentMethod } });
});
