import { DateTime } from "luxon";
import { Schema } from "mongoose";
import { modelFor, schemaOptions, optionalUserRef, nonnegativeInteger, paise, twoDigit } from "@/lib/db/schema";

export const settlementSummarySchema = new Schema({
  totalBets: nonnegativeInteger, winningBets: nonnegativeInteger, losingBets: nonnegativeInteger,
  totalStakePaise: paise, totalPayoutPaise: paise,
}, { _id: false, strict: "throw" });
export const marketRoundSchema = new Schema({
  marketId: { type: Schema.Types.ObjectId, ref: "Market", required: true },
  businessDate: { type: String, required: true, validate: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value).isValid },
  opensAt: { type: Date, required: true },
  editCutoffAt: { type: Date, required: true },
  closesAt: { type: Date, required: true },
  result: twoDigit,
  resultDeclaredAt: Date,
  declaredByAdminId: optionalUserRef,
  settlementStatus: { type: String, enum: ["PENDING", "PROCESSING", "SETTLED", "FAILED"], default: "PENDING", required: true },
  settledAt: Date,
  settlementSummary: settlementSummarySchema,
}, schemaOptions);
marketRoundSchema.pre("validate", function () {
  if (!(this.opensAt < this.closesAt) || !(this.editCutoffAt <= this.closesAt)) this.invalidate("closesAt", "Invalid round time ordering.");
  if (this.result != null && (!this.resultDeclaredAt || !this.declaredByAdminId)) this.invalidate("result", "Result declaration metadata required.");
  if (this.resultDeclaredAt && this.resultDeclaredAt < this.closesAt) this.invalidate("resultDeclaredAt", "Cannot declare before close.");
  if (this.settlementStatus !== "PENDING" && this.result == null) this.invalidate("result", "Settlement requires a declared result.");
  if (this.settlementStatus === "SETTLED" && (!this.settledAt || !this.settlementSummary)) this.invalidate("settledAt", "Settled round requires time and summary.");
});
marketRoundSchema.index({ marketId: 1, businessDate: 1 }, { unique: true });
marketRoundSchema.index({ closesAt: 1 });
export const MarketRound = modelFor("MarketRound", marketRoundSchema, "marketRounds");
