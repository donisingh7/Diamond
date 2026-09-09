import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getImageForViewer } from "@/modules/payments/services/proof-image.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/deposits/proof/[id] — the raw image bytes. Any signed-in user may fetch a payment
 * method QR; a deposit proof is visible only to the player who uploaded it or an admin. A miss
 * and an unauthorized hit are the same `404 IMAGE_NOT_FOUND`, so an id never confirms a
 * stranger's proof exists.
 */
export const GET = apiRoute(async (_request: NextRequest, ctx: RouteContext<"/api/deposits/proof/[id]">) => {
  const user = await requireAuthenticatedUser();
  const { id } = await ctx.params;
  const image = await getImageForViewer(id, { _id: user._id, role: user.role });
  return new NextResponse(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.sizeBytes),
      "Cache-Control": "private, max-age=60",
    },
  });
});
