import { Schema, type InferSchemaType } from "mongoose";
import { modelFor, schemaOptions, requiredText, nonnegativeInteger } from "@/lib/db/schema";
import { marketScheduleSchema } from "@/lib/dates/market-time";

export const marketSchema = new Schema({
  name: requiredText,
  slug: { ...requiredText, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  code: { ...requiredText, uppercase: true, match: /^[A-Z0-9]+$/ },
  timezone: { type: String, enum: ["Asia/Kolkata"], required: true },
  openTimeMinutes: { ...nonnegativeInteger, max: 1439 },
  closeTimeMinutes: { ...nonnegativeInteger, max: 1439 },
  closeDayOffset: { ...nonnegativeInteger, max: 1 },
  editLockMinutesBeforeClose: nonnegativeInteger,
  enabled: { type: Boolean, default: true, required: true },
  displayOrder: nonnegativeInteger,
}, schemaOptions);
marketSchema.pre("validate", function () {
  if (!marketScheduleSchema.safeParse(this.toObject()).success) this.invalidate("closeTimeMinutes", "Invalid market schedule.");
});
marketSchema.index({ slug: 1 }, { unique: true });
marketSchema.index({ code: 1 }, { unique: true });
export type MarketRecord = InferSchemaType<typeof marketSchema>;
export const Market = modelFor("Market", marketSchema, "markets");
