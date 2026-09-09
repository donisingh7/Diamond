import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { parseImageUpload, storeImage } from "@/modules/payments/services/proof-image.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/payment-methods/qr — ADMIN only, same-origin. Multipart `file` field with a
 * UPI QR image (PNG / JPEG / WebP, ≤ 5 MiB). Stored as a `kind: "QR"` image (readable by any
 * signed-in user so players can display it). Returns the id to set as `qrImageId` on a UPI
 * payment method.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const admin = await requireAdmin();
  const { contentType, bytes } = await parseImageUpload(request);
  const stored = await storeImage({ ownerId: admin._id, kind: "QR", contentType, bytes });
  return NextResponse.json({ data: { qrImageId: stored.id, contentType: stored.contentType, sizeBytes: stored.sizeBytes } });
});
