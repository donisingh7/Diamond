import { Schema } from "mongoose";
import { modelFor, createdOnlyOptions, userRef, nonnegativeInteger } from "@/lib/db/schema";

export const otpRequestSchema = new Schema({
  userId: userRef,
  codeHash: { type: String, required: true, select: false },
  purpose: { type: String, enum: ["LOGIN"], required: true },
  attempts: { ...nonnegativeInteger, default: 0 },
  expiresAt: { type: Date, required: true },
  consumedAt: Date,
}, createdOnlyOptions);
otpRequestSchema.index({ userId: 1 });
otpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const OtpRequest = modelFor("OtpRequest", otpRequestSchema, "otpRequests");
