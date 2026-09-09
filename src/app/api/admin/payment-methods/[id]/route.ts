import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { updatePaymentMethodSchema } from "@/modules/payments/validators/payment-input";
import { updatePaymentMethod } from "@/modules/payments/services/payment-method.service";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/payment-methods/[id] — ADMIN only, same-origin. Partial `.strict()` update;
 * `type` is immutable and a field belonging to the other kind is rejected. `isActive: false`
 * deactivates (never a delete) — historical DepositRequest snapshots are untouched. Audited
 * `PAYMENT_METHOD_UPDATED` with a masked before/after.
 */
export const PATCH = apiRoute(async (request: NextRequest, ctx: RouteContext<"/api/admin/payment-methods/[id]">) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = updatePaymentMethodSchema.parse(await request.json());
  const paymentMethod = await updatePaymentMethod({ actorAdminId: admin._id, id, patch: body });
  return NextResponse.json({ data: { paymentMethod } });
});
