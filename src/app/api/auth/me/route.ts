import "server-only";
import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { getCurrentUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { toPublicUser } from "@/modules/users/services/public-user";

/** A disabled/deleted user's stale cookie resolves to null here too, so it reads as unauthenticated. */
export const GET = apiRoute(async () => {
  const user = await getCurrentUser();
  if (!user) throw new DomainError("UNAUTHENTICATED", "Sign in required.");
  return NextResponse.json({ data: { user: toPublicUser(user) } });
});
