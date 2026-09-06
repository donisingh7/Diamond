import "server-only";
import { timingSafeEqual } from "node:crypto";
import { Types } from "mongoose";
import { withTransaction } from "@/lib/db/connection";
import { DomainError } from "@/lib/errors/domain-error";
import { User } from "@/modules/users/models/user.model";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import { OtpRequest } from "../models/otp-request.model";
import { MockOtpProvider, generateOtpCode, hashOtpCode, type OtpProvider } from "../providers/otp-provider";
import { createSession, type ActiveUser } from "./session.service";
import { OTP_EXPIRY_MS, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_MS } from "../config";

const invalidOtp = () => new DomainError("INVALID_OTP", "Invalid or expired code.");

/** No console logging, persisted plaintext or public code endpoint outside explicit development return values. */
const defaultProvider: OtpProvider = new MockOtpProvider(async ({ code }) => {
  if (process.env.NODE_ENV === "development") console.log(`[MockOtpProvider] delivery code=${code}`);
});

/** Same shape as a real request id so an ineligible phone cannot be distinguished from an eligible one. */
function decoyRequestId(): string {
  return new Types.ObjectId().toHexString();
}

export type OtpRequestResult = { requestId: string; devCode?: string };

/**
 * Always returns a generic-looking result. No OtpRequest row is created for an unknown/disabled/non-player
 * phone, so verification against a decoy id fails the same way a wrong code would.
 */
export async function requestPlayerOtp(rawPhone: string, provider: OtpProvider = defaultProvider): Promise<OtpRequestResult> {
  const settings = await PlatformSettings.findOne({ key: "platform" });
  if (!settings?.mockOtpEnabled) return { requestId: decoyRequestId() };

  const phone = rawPhone.trim();
  const user = await User.findOne({ phone, role: "PLAYER", status: "ACTIVE" });
  if (!user) return { requestId: decoyRequestId() };

  const recent = await OtpRequest.findOne({ userId: user._id, consumedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  if (recent && Date.now() - recent.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    return { requestId: recent._id.toString() };
  }

  const requestId = new Types.ObjectId();
  const code = generateOtpCode();
  await OtpRequest.create({
    _id: requestId, userId: user._id, purpose: "LOGIN", attempts: 0,
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MS), codeHash: hashOtpCode(requestId.toString(), code),
  });
  await provider.send({ userId: user._id.toString(), requestId: requestId.toString(), code });
  return { requestId: requestId.toString(), devCode: process.env.NODE_ENV === "development" ? code : undefined };
}

/**
 * Consumption is compare-and-set inside a transaction so a retried/duplicate verify request cannot
 * create a second session from the same code, and every rejection path returns the identical generic error.
 */
export async function verifyPlayerOtp(requestId: string, code: string): Promise<{ user: ActiveUser; rawToken: string }> {
  if (!Types.ObjectId.isValid(requestId)) throw invalidOtp();

  // Outside any transaction: a wrong-code attempt must persist even though the overall call throws,
  // and throwing inside a transaction callback rolls back everything written during that callback.
  const otp = await OtpRequest.findById(requestId).select("+codeHash");
  if (!otp || otp.consumedAt || otp.expiresAt.getTime() <= Date.now() || otp.attempts >= OTP_MAX_ATTEMPTS) throw invalidOtp();

  const expected = Buffer.from(hashOtpCode(requestId, code), "hex");
  const actual = Buffer.from(otp.codeHash, "hex");
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!matches) {
    await OtpRequest.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    throw invalidOtp();
  }

  return withTransaction(async (session) => {
    const consumed = await OtpRequest.findOneAndUpdate({ _id: otp._id, consumedAt: null }, { $set: { consumedAt: new Date() } }, { session });
    if (!consumed) throw invalidOtp();

    const user = await User.findById(otp.userId).session(session);
    if (!user || user.status !== "ACTIVE" || user.role !== "PLAYER") throw invalidOtp();

    const { rawToken } = await createSession(user._id, session);
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).session(session);
    return { user, rawToken };
  });
}
