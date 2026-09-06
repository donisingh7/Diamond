import { Schema } from "mongoose";
import { modelFor, userRef, nonnegativeInteger, integer, requiredText } from "@/lib/db/schema";
import { safeAdd } from "@/lib/money";
import { compositionSchema } from "./composition.schema";

export const betRevisionSchema = new Schema({
  betId: { type: Schema.Types.ObjectId, ref: "Bet", required: true },
  userId: userRef,
  fromVersion: { ...nonnegativeInteger, min: 1 },
  toVersion: { ...nonnegativeInteger, min: 2 },
  before: { type: compositionSchema, required: true },
  after: { type: compositionSchema, required: true },
  walletDeltaPaise: integer,
  editRequestId: requiredText,
  editedAt: { type: Date, required: true },
}, { strict: "throw" });
betRevisionSchema.pre("validate", function () {
  if (this.toVersion !== this.fromVersion + 1) this.invalidate("toVersion", "Revision must advance exactly one version.");
  if (this.before && this.after && this.walletDeltaPaise !== safeAdd(this.before.totalStakePaise, -this.after.totalStakePaise)) this.invalidate("walletDeltaPaise", "Delta must equal previous total minus new total.");
});
betRevisionSchema.index({ betId: 1, toVersion: 1 }, { unique: true });
betRevisionSchema.index({ userId: 1, editedAt: -1 });
betRevisionSchema.index({ userId: 1, editRequestId: 1 }, { unique: true });
export const BetRevision = modelFor("BetRevision", betRevisionSchema, "betRevisions");
