import { Schema } from "mongoose";
import { positivePaise, twoDigit, paise } from "@/lib/db/schema";
import { safeAdd } from "@/lib/money";
import { entryInputSchema } from "../validators/bet-input";

export const entryMethods = ["JODI", "CROSSING", "COPY_PASTE"] as const;
export const entryMetadataSchema = new Schema({
  numbers: { type: [String], default: undefined }, digits: String, rawInput: String, palti: Boolean,
}, { _id: false, strict: "throw" });
export const selectionSchema = new Schema({
  number: { ...twoDigit, required: true }, stakePaise: positivePaise,
}, { _id: false, strict: "throw" });
export const compositionFields = {
  entryMethod: { type: String, enum: entryMethods, required: true },
  entryMetadata: { type: entryMetadataSchema, required: true },
  selections: { type: [selectionSchema], required: true, validate: {
    validator: (values: { number: string }[]) => values.length > 0 && values.length <= 100 && new Set(values.map((s) => s.number)).size === values.length,
    message: "Selections must be a nonempty unique set of two-digit numbers.",
  } },
  totalStakePaise: positivePaise,
} as const;

export const compositionSchema = new Schema(compositionFields, { _id: false, strict: "throw" });
compositionSchema.pre("validate", function () {
  if (safeAdd(...this.selections.map((s) => s.stakePaise)) !== this.totalStakePaise) this.invalidate("totalStakePaise", "Total must equal sum of selections.");
  if (!entryInputSchema.safeParse({ entryMethod: this.entryMethod, ...this.toObject().entryMetadata }).success) this.invalidate("entryMetadata", "Metadata must match entry method.");
});
export const payoutField = paise;
