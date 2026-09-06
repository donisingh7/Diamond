import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { connectDatabase } from "@/lib/db/connection";
import { apiRoute } from "@/lib/api/handler";
import { isTrustedOrigin } from "@/lib/http/same-origin";
import { DomainError } from "@/lib/errors/domain-error";
import { otpRequestSchema } from "@/modules/auth/validators/auth-input";
import { requestPlayerOtp } from "@/modules/auth/services/otp.service";

/** Always the same generic acknowledgement, whether or not the phone belongs to an eligible player. */
export const POST = apiRoute(async (request: NextRequest) => {
  if (!isTrustedOrigin(request)) throw new DomainError("FORBIDDEN", "Request origin not trusted.");
  const body = otpRequestSchema.parse(await request.json());
  await connectDatabase();
  const result = await requestPlayerOtp(body.phone);
  return NextResponse.json({
    data: { requestId: result.requestId, message: "If this phone is registered and eligible, an OTP has been sent.", devCode: result.devCode },
  });
});
