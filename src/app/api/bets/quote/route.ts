import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { requirePlayer } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { quoteRequestSchema } from "@/modules/betting/validators/quote-input";
import { quoteBet } from "@/modules/betting/services/quote.service";

// Reads the session cookie and the database on every call; nothing here is cacheable.
export const dynamic = "force-dynamic";

/**
 * POST /api/bets/quote — ACTIVE PLAYER only (an ADMIN session is FORBIDDEN; the role
 * boundary is not widened). Discriminated Zod body; a Zod failure is `400 INVALID_INPUT`.
 *
 * The quote is informational: it performs NO wallet check and writes NO bet / wallet /
 * ledger document. It is non-binding — later placement revalidates everything server-side.
 */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  await requirePlayer();
  const body = quoteRequestSchema.parse(await request.json());
  const now = new Date();
  const quote = await quoteBet(body, now);
  return NextResponse.json({ data: quote });
});
