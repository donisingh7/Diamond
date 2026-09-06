import { Schema } from "mongoose";
import { modelFor, createdOnlyOptions, userRef } from "@/lib/db/schema";

export const sessionSchema = new Schema({
  userId: userRef,
  tokenHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  lastSeenAt: Date,
}, createdOnlyOptions);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = modelFor("Session", sessionSchema, "sessions");
