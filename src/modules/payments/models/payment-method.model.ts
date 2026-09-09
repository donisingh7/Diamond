import { Schema, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";
import { modelFor, schemaOptions, optionalUserRef } from "@/lib/db/schema";

/**
 * Window 10A — an admin-configured destination a player pays money to OUT of band (their own
 * UPI app / bank transfer) before raising a DepositRequest. Two kinds:
 *
 *  - `UPI`  : `upiId` + optional `qrImageId` (a {@link ProofImage} of `kind: "QR"`)
 *  - `BANK` : `accountHolderName` + `bankName` + `accountNumber` + `ifsc`
 *
 * `strict: "throw"` + a `pre("validate")` cross-check keep a UPI row from carrying bank columns
 * and vice-versa. `isActive` gates player visibility; `sortOrder` is display order. A method is
 * NEVER hard-deleted — deactivation preserves the row so historical DepositRequests that
 * snapshotted it stay explicable. These fields are operator-entered payout coordinates, not
 * secrets, but the admin account number is masked in every audit snapshot.
 */

export const paymentMethodTypes = ["UPI", "BANK"] as const;
export type PaymentMethodType = (typeof paymentMethodTypes)[number];

export const paymentMethodSchema = new Schema({
  type: { type: String, enum: paymentMethodTypes, required: true, immutable: true },
  displayName: { type: String, required: true, trim: true, maxlength: 120 },
  instructions: { type: String, trim: true, maxlength: 2000 },
  isActive: { type: Boolean, required: true, default: true },
  sortOrder: { type: Number, required: true, default: 0, validate: Number.isSafeInteger },
  createdByAdminId: optionalUserRef,
  updatedByAdminId: optionalUserRef,

  // --- UPI ---
  upiId: { type: String, trim: true, maxlength: 256 },
  /** ProofImage (_id, kind "QR"). Optional. */
  qrImageId: { type: Schema.Types.ObjectId, ref: "ProofImage" },

  // --- BANK ---
  accountHolderName: { type: String, trim: true, maxlength: 140 },
  bankName: { type: String, trim: true, maxlength: 140 },
  accountNumber: { type: String, trim: true, maxlength: 34 },
  ifsc: { type: String, trim: true, maxlength: 11 },
}, schemaOptions);

paymentMethodSchema.pre("validate", function () {
  if (this.type === "UPI") {
    if (!this.upiId?.trim()) this.invalidate("upiId", "A UPI method requires a upiId.");
    if (this.accountNumber || this.ifsc || this.accountHolderName || this.bankName) {
      this.invalidate("type", "A UPI method must not carry bank fields.");
    }
  } else {
    if (!this.accountHolderName?.trim() || !this.bankName?.trim() || !this.accountNumber?.trim() || !this.ifsc?.trim()) {
      this.invalidate("accountNumber", "A BANK method requires accountHolderName, bankName, accountNumber and ifsc.");
    }
    if (this.upiId || this.qrImageId) this.invalidate("type", "A BANK method must not carry UPI fields.");
  }
});

paymentMethodSchema.index({ isActive: 1, sortOrder: 1, _id: 1 });

export type PaymentMethodRecord = InferSchemaType<typeof paymentMethodSchema>;
export type PaymentMethodDoc = HydratedDocument<PaymentMethodRecord>;
export type PaymentMethodRow = PaymentMethodRecord & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const PaymentMethod = modelFor("PaymentMethod", paymentMethodSchema, "paymentMethods");
