import { Schema, type InferSchemaType } from "mongoose";
import { modelFor, schemaOptions, requiredText, optionalUserRef } from "@/lib/db/schema";
import { normalizeLoginId } from "../validators/identity";

const optionalText = (value: unknown) => value == null ? undefined : typeof value === "string" ? value.trim() || undefined : value;
export const userSchema = new Schema({
  role: { type: String, enum: ["PLAYER", "ADMIN"], required: true },
  loginId: { ...requiredText, set: normalizeLoginId },
  name: requiredText,
  phone: { type: String, set: optionalText },
  email: { type: String, lowercase: true, set: optionalText, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  passwordHash: { type: String, required: true, select: false },
  status: { type: String, enum: ["ACTIVE", "DISABLED"], default: "ACTIVE", required: true },
  createdBy: optionalUserRef,
  passwordChangedAt: Date,
  lastLoginAt: Date,
}, schemaOptions);
userSchema.index({ loginId: 1 }, { unique: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
export type UserRecord = InferSchemaType<typeof userSchema>;
export const User = modelFor("User", userSchema, "users");
