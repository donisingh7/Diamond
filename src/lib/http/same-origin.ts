import "server-only";
import type { NextRequest } from "next/server";

/**
 * Lightweight CSRF guard for cookie-authenticated mutations: SameSite=Lax already blocks most
 * cross-site cookie-carrying requests, so this only needs to catch the rest without a framework.
 * Browsers attach Origin on state-changing cross-origin fetches; a same-origin request may omit
 * it, so a missing header is allowed and a mismatched one is rejected.
 */
export function isTrustedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}
