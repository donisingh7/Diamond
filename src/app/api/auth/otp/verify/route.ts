import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { connectDatabase } from "@/lib/db/connection";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { setSessionCookie } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors/domain-error";
import { otpVerifySchema } from "@/modules/auth/validators/auth-input";
import { verifyPlayerOtp } from "@/modules/auth/services/otp.service";
import { toPublicUser } from "@/modules/users/services/public-user";

export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const body = otpVerifySchema.parse(await request.json());
  await connectDatabase();
  const { user, rawToken } = await verifyPlayerOtp(body.requestId, body.code);
  const response = NextResponse.json({ data: { user: toPublicUser(user) } });
  setSessionCookie(response, rawToken);
  return response;
});
