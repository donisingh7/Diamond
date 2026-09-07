import { Schema, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";
import { modelFor, schemaOptions, userRef, optionalUserRef, positivePaise, requiredText } from "@/lib/db/schema";

/**
 * Sensitive payout instrument. `strict: "throw"` guarantees the duplicated account-number
 * confirmation the request carries can never be persisted here (an unknown key throws). The
 * whole sub-document is `select: false` on the parent so it is excluded from ordinary reads;
 * player read/DTO paths never project it (they use `destinationSummary` instead). Bounds are
 * defence-in-depth behind the Zod request schema.
 */
const paymentDetailsSchema = new Schema({
  accountHolderName: { type: String, trim: true, maxlength: 140 },
  accountNumber: { type: String, trim: true, maxlength: 34 },
  ifsc: { type: String, trim: true, maxlength: 11 },
  bankName: { type: String, trim: true, maxlength: 140 },
  upiId: { type: String, trim: true, maxlength: 256 },
}, { _id: false, strict: "throw" });

export const withdrawalSchema = new Schema({
  userId: userRef,
  clientRequestId: { ...requiredText, immutable: true },
  amountPaise: { ...positivePaise, immutable: true },
  method: { type: String, enum: ["BANK", "UPI"], required: true, immutable: true },
  paymentDetails: { type: paymentDetailsSchema, required: true, select: false, immutable: true },
  /** Non-sensitive, pre-masked ("HDFC Bank ••••1234" / "ab••@okhdfc") — the only destination
   *  string that crosses an HTTP boundary. Kept denormalised so read paths never touch
   *  `paymentDetails`. */
  destinationSummary: { ...requiredText, immutable: true, maxlength: 160 },
  status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"], default: "PENDING", required: true },
  rejectionReason: { type: String, trim: true, maxlength: 500 },
  requestedAt: { type: Date, required: true, immutable: true },
  decidedAt: Date,
  decidedByAdminId: optionalUserRef,
  /** Window 6A2 admin-decision idempotency + operational metadata. `decisionRequestId` is the
   *  admin's client UUID for the terminal "Mark Paid & Approve" / reject; a unique sparse index
   *  makes a reuse for a different withdrawal collide. `paymentReference` is the operator's
   *  out-of-Diamond payout reference (UTR / txn id) on approve; `decisionNote` a bounded note.
   *  None of these carry the sensitive `paymentDetails`. */
  decisionRequestId: { type: String, trim: true },
  paymentReference: { type: String, trim: true, maxlength: 200 },
  decisionNote: { type: String, trim: true, maxlength: 500 },
}, schemaOptions);
withdrawalSchema.pre("validate", function () {
  const details = this.paymentDetails;
  if (details && (this.method === "BANK"
    ? !details.accountHolderName?.trim() || !details.accountNumber?.trim() || !details.ifsc?.trim() || !!details.upiId
    : !details.upiId?.trim() || !!details.accountNumber || !!details.ifsc)) this.invalidate("paymentDetails", "Payment details must match the withdrawal method.");
  if (this.status === "REJECTED" && !this.rejectionReason?.trim()) this.invalidate("rejectionReason", "Rejection reason required.");
  if (this.status !== "PENDING" && !this.decidedAt) this.invalidate("decidedAt", "Decision timestamp required.");
  if (["APPROVED", "REJECTED"].includes(this.status) && !this.decidedByAdminId) this.invalidate("decidedByAdminId", "Admin decision attribution required.");
});
withdrawalSchema.index({ userId: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, requestedAt: 1 });
withdrawalSchema.index({ userId: 1, clientRequestId: 1 }, { unique: true });
/** Window 6A2: global admin withdrawal list, newest requested first with a stable (requestedAt, _id) cursor. */
withdrawalSchema.index({ requestedAt: -1, _id: -1 });
/** Window 6A2: admin-decision idempotency backstop — a `decisionRequestId` is unique across all withdrawals. */
withdrawalSchema.index({ decisionRequestId: 1 }, { unique: true, sparse: true });
/** Type-only exports (no schema/index change). */
export type WithdrawalRecord = InferSchemaType<typeof withdrawalSchema>;
export type WithdrawalDoc = HydratedDocument<WithdrawalRecord>;
/** Lean-read shape: the record plus the fields `.lean()` always returns (`timestamps: true`). */
export type WithdrawalRow = WithdrawalRecord & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const Withdrawal = modelFor("Withdrawal", withdrawalSchema, "withdrawals");
