import { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { modelFor, schemaOptions, userRef, requiredText, nonnegativeInteger, twoDigit } from "@/lib/db/schema";
import { safeAdd } from "@/lib/money";
import { compositionFields, payoutField } from "./composition.schema";
import { entryInputSchema } from "../validators/bet-input";

export const betSchema = new Schema({
  publicRef: { ...requiredText, immutable: true },
  clientRequestId: { ...requiredText, immutable: true },
  userId: userRef,
  marketId: { type: Schema.Types.ObjectId, ref: "Market", required: true },
  marketRoundId: { type: Schema.Types.ObjectId, ref: "MarketRound", required: true },
  ...compositionFields,
  totalSelections: { ...nonnegativeInteger, min: 1, max: 100 },
  payoutMultiplierSnapshot: { ...nonnegativeInteger, min: 1, immutable: true },
  status: { type: String, enum: ["ACTIVE", "WON", "LOST"], default: "ACTIVE", required: true },
  winningNumber: twoDigit,
  payoutPaise: { ...payoutField, required: false },
  version: { ...nonnegativeInteger, min: 1, default: 1 },
  placedAt: { type: Date, required: true },
  lastEditedAt: Date,
  settledAt: Date,
}, schemaOptions);
betSchema.pre("validate", function () {
  if (this.totalSelections !== this.selections.length) this.invalidate("totalSelections", "Count must match selections.");
  if (safeAdd(...this.selections.map((s) => s.stakePaise)) !== this.totalStakePaise) this.invalidate("totalStakePaise", "Total must equal sum of selections.");
  if (!entryInputSchema.safeParse({ entryMethod: this.entryMethod, ...this.toObject().entryMetadata }).success) this.invalidate("entryMetadata", "Metadata must match entry method.");
  if (this.status !== "ACTIVE" && (!this.settledAt || this.winningNumber == null || this.payoutPaise == null)) this.invalidate("status", "Settled bet requires outcome metadata.");
});
betSchema.index({ publicRef: 1 }, { unique: true });
betSchema.index({ userId: 1, createdAt: -1 });
betSchema.index({ marketRoundId: 1, status: 1 });
betSchema.index({ marketId: 1, createdAt: -1 });
betSchema.index({ userId: 1, clientRequestId: 1 }, { unique: true });
/** Type-only exports (no schema/index change). `version` is the domain version, distinct from Mongoose `__v`. */
export type BetRecord = InferSchemaType<typeof betSchema>;
export type BetDoc = HydratedDocument<BetRecord>;
export const Bet = modelFor("Bet", betSchema, "bets");
