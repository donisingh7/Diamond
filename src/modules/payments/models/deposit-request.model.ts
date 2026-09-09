import { Schema, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";
import { modelFor, schemaOptions, userRef, optionalUserRef, positivePaise, requiredText } from "@/lib/db/schema";
import { paymentMethodTypes } from "./payment-method.model";

/**
 * Window 10A — a player's claim that they paid `requestedAmountPaise` to a specific
 * {@link PaymentMethod} out of band, evidenced by a UTR / reference and a proof screenshot.
 * An admin reviews it and either APPROVES (crediting `approvedAmountPaise`, which MAY differ
 * from what was requested) or REJECTS (no wallet movement). Only PENDING is mutable.
 *
 * `requestedAmountPaise` is `immutable` — the admin's editable figure lands in the separate
 * `approvedAmountPaise` and the original is never lost. `paymentMethodSnapshot` freezes the
 * method's display coordinates at submit time (account number already masked) so a later edit
 * or deactivation of the live method never rewrites history. `normalizedUtr` (upper-cased,
 * separators stripped) has a global unique index — the same transfer can back only one request.
 */

const paymentMethodSnapshotSchema = new Schema({
  paymentMethodId: { type: Schema.Types.ObjectId, required: true },
  type: { type: String, enum: paymentMethodTypes, required: true },
  displayName: { ...requiredText, maxlength: 120 },
  instructions: { type: String, trim: true, maxlength: 2000 },
  upiId: { type: String, trim: true, maxlength: 256 },
  accountHolderName: { type: String, trim: true, maxlength: 140 },
  bankName: { type: String, trim: true, maxlength: 140 },
  /** Masked at snapshot time — e.g. "••••1234". A full account number is never stored here. */
  accountNumberMasked: { type: String, trim: true, maxlength: 34 },
  ifsc: { type: String, trim: true, maxlength: 11 },
}, { _id: false, strict: "throw" });

export const depositRequestStatuses = ["PENDING", "APPROVED", "REJECTED"] as const;
export type DepositRequestStatus = (typeof depositRequestStatuses)[number];

export const depositRequestSchema = new Schema({
  userId: userRef,
  clientRequestId: { ...requiredText, immutable: true },
  requestedAmountPaise: { ...positivePaise, immutable: true },
  /** Set only on APPROVED. May be lower OR higher than `requestedAmountPaise`. */
  approvedAmountPaise: { type: Number, min: 1, validate: Number.isSafeInteger },
  paymentMethodId: { type: Schema.Types.ObjectId, ref: "PaymentMethod", required: true, immutable: true },
  paymentMethodSnapshot: { type: paymentMethodSnapshotSchema, required: true, immutable: true },
  /** Player-entered, kept verbatim for display / support. */
  utr: { ...requiredText, immutable: true, maxlength: 64 },
  /** Upper-cased, `[^A-Z0-9]` stripped. Unique across ALL requests. */
  normalizedUtr: { ...requiredText, immutable: true, maxlength: 64 },
  proofImageId: { type: Schema.Types.ObjectId, ref: "ProofImage", required: true, immutable: true },
  status: { type: String, enum: depositRequestStatuses, default: "PENDING", required: true },
  /** Required on REJECT, and on APPROVE when the approved amount differs from requested. */
  adminRemark: { type: String, trim: true, maxlength: 1000 },
  reviewedByAdminId: optionalUserRef,
  submittedAt: { type: Date, required: true, immutable: true },
  reviewedAt: Date,
}, schemaOptions);

depositRequestSchema.pre("validate", function () {
  if (this.status === "PENDING") {
    if (this.approvedAmountPaise != null || this.reviewedByAdminId || this.reviewedAt) {
      this.invalidate("status", "A PENDING deposit carries no review fields.");
    }
    return;
  }
  if (!this.reviewedByAdminId) this.invalidate("reviewedByAdminId", "Review attribution required.");
  if (!this.reviewedAt) this.invalidate("reviewedAt", "Review timestamp required.");
  if (this.status === "REJECTED") {
    if (!this.adminRemark?.trim()) this.invalidate("adminRemark", "A rejection requires an admin remark.");
    if (this.approvedAmountPaise != null) this.invalidate("approvedAmountPaise", "A rejected deposit credits nothing.");
  }
  if (this.status === "APPROVED") {
    if (!(typeof this.approvedAmountPaise === "number" && this.approvedAmountPaise > 0)) {
      this.invalidate("approvedAmountPaise", "An approved deposit needs a positive approved amount.");
    } else if (this.approvedAmountPaise !== this.requestedAmountPaise && !this.adminRemark?.trim()) {
      this.invalidate("adminRemark", "Changing the approved amount requires an admin remark.");
    }
  }
});

depositRequestSchema.index({ userId: 1, clientRequestId: 1 }, { unique: true });
depositRequestSchema.index({ normalizedUtr: 1 }, { unique: true });
depositRequestSchema.index({ status: 1, submittedAt: -1, _id: -1 });
depositRequestSchema.index({ userId: 1, submittedAt: -1, _id: -1 });
depositRequestSchema.index({ submittedAt: -1, _id: -1 });

export type DepositRequestRecord = InferSchemaType<typeof depositRequestSchema>;
export type DepositRequestDoc = HydratedDocument<DepositRequestRecord>;
export type DepositRequestRow = DepositRequestRecord & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const DepositRequest = modelFor("DepositRequest", depositRequestSchema, "depositRequests");
