import { Schema } from "mongoose";
import { modelFor, schemaOptions, positivePaise, nonnegativeInteger } from "@/lib/db/schema";

export const platformSettingsSchema = new Schema({
  key: { type: String, enum: ["platform"], required: true, immutable: true },
  currency: { type: String, enum: ["INR"], required: true },
  timezone: { type: String, enum: ["Asia/Kolkata"], required: true },
  minimumStakePaise: { ...positivePaise, enum: [100] },
  payoutMultiplier: { ...nonnegativeInteger, min: 1 },
  mockDepositEnabled: { type: Boolean, required: true },
  mockOtpEnabled: { type: Boolean, required: true },
}, schemaOptions);
platformSettingsSchema.index({ key: 1 }, { unique: true });
export const PlatformSettings = modelFor("PlatformSettings", platformSettingsSchema, "platformSettings");
