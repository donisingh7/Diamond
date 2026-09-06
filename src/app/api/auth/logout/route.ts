import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { connectDatabase } from "@/lib/db/connection";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { clearSessionCookie } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { revokeSessionByToken } from "@/modules/auth/services/session.service";
import { SESSION_COOKIE_NAME } from "@/modules/auth/config";

/** Idempotent: an absent or already-invalid session still results in a logged-out browser. */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await connectDatabase();
    await revokeSessionByToken(token);
  }
  const response = NextResponse.json({ data: { loggedOut: true } });
  clearSessionCookie(response);
  return response;
});
