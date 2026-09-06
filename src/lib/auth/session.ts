import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { connectDatabase } from "@/lib/db/connection";
import { DomainError } from "@/lib/errors/domain-error";
import { findActiveSessionUser, type ActiveUser } from "@/modules/auth/services/session.service";
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "@/modules/auth/config";

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Local HTTP development explicitly omits Secure; production always requires it.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function setSessionCookie(response: NextResponse, rawToken: string): void {
  response.cookies.set(SESSION_COOKIE_NAME, rawToken, cookieOptions(Math.floor(SESSION_DURATION_MS / 1000)));
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", cookieOptions(0));
}

/**
 * Read-side entrypoint for Server Components/layouts; findActiveSessionUser rechecks existence/status/expiry.
 * Wrapped in React's per-request cache so a protected layout and its page don't each re-hit the database.
 */
export const getCurrentUser = cache(async (): Promise<ActiveUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  await connectDatabase();
  return findActiveSessionUser(token);
});

export async function requireAuthenticatedUser(): Promise<ActiveUser> {
  const user = await getCurrentUser();
  if (!user) throw new DomainError("UNAUTHENTICATED", "Sign in required.");
  return user;
}

export async function requirePlayer(): Promise<ActiveUser> {
  const user = await requireAuthenticatedUser();
  if (user.role !== "PLAYER") throw new DomainError("FORBIDDEN", "Player access required.");
  return user;
}

export async function requireAdmin(): Promise<ActiveUser> {
  const user = await requireAuthenticatedUser();
  if (user.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Admin access required.");
  return user;
}
