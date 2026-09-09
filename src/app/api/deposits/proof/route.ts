import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requirePlayer } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { parseImageUpload, storeImage } from "@/modules/payments/services/proof-image.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/deposits/proof — ACTIVE PLAYER only, same-origin. Multipart `file` field carrying a
 * PNG / JPEG / WebP screenshot of the completed payment, ≤ 5 MiB. Stored as BSON binary in the
 * `proofImages` collection (never the filesystem) and owned by the caller. Returns the id to
 * attach to a subsequent `POST /api/deposits`.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const user = await requirePlayer();
  const { contentType, bytes } = await parseImageUpload(request);
  const stored = await storeImage({ ownerId: user._id, kind: "DEPOSIT_PROOF", contentType, bytes });
  return NextResponse.json({ data: { proofImageId: stored.id, contentType: stored.contentType, sizeBytes: stored.sizeBytes } });
});
