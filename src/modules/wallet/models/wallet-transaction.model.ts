import { Schema, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";
import { modelFor, createdOnlyOptions, userRef, optionalUserRef, paise, integer, requiredText } from "@/lib/db/schema";
import { safeAdd } from "@/lib/money";

export const walletTransactionTypes = [
  "MOCK_DEPOSIT", "BET_PLACED", "BET_EDIT_DEBIT", "BET_EDIT_REFUND", "WIN_CREDIT",
  "WITHDRAWAL_RESERVED", "WITHDRAWAL_RELEASED", "WITHDRAWAL_APPROVED", "ADMIN_CREDIT", "ADMIN_DEBIT",
] as const;
export type WalletTransactionType = (typeof walletTransactionTypes)[number];
export const walletTransactionSchema = new Schema({
  userId: userRef,
  walletId: { type: Schema.Types.ObjectId, ref: "Wallet", required: true },
  type: { type: String, enum: walletTransactionTypes, required: true },
  amountPaise: { ...paise, min: 1 },
  availableDeltaPaise: integer,
  reservedDeltaPaise: integer,
  availableBeforePaise: paise,
  availableAfterPaise: paise,
  reservedBeforePaise: paise,
  reservedAfterPaise: paise,
  referenceType: String,
  referenceId: Schema.Types.ObjectId,
  idempotencyKey: requiredText,
  createdByAdminId: optionalUserRef,
  /** Set only for ADMIN_CREDIT / ADMIN_DEBIT — the operator-supplied justification and optional
   *  external payment reference for a manual money movement (Window 6A1). Never projected into a
   *  player-facing DTO. `strict:"throw"` means these must be declared here for the admin wallet
   *  service to persist them alongside the immutable ledger row. */
  adminReason: { type: String, trim: true, maxlength: 500 },
  adminPaymentReference: { type: String, trim: true, maxlength: 200 },
}, createdOnlyOptions);
walletTransactionSchema.pre("validate", function () {
  if (safeAdd(this.availableBeforePaise, this.availableDeltaPaise) !== this.availableAfterPaise
    || safeAdd(this.reservedBeforePaise, this.reservedDeltaPaise) !== this.reservedAfterPaise) {
    this.invalidate("amountPaise", "Ledger before/delta/after values must reconcile.");
  }
  const amount = this.amountPaise;
  const debit = ["BET_PLACED", "BET_EDIT_DEBIT", "ADMIN_DEBIT"].includes(this.type);
  const expected = this.type === "WITHDRAWAL_RESERVED" ? [-amount, amount]
    : this.type === "WITHDRAWAL_RELEASED" ? [amount, -amount]
    : this.type === "WITHDRAWAL_APPROVED" ? [0, -amount]
    : [debit ? -amount : amount, 0];
  if (this.availableDeltaPaise !== expected[0] || this.reservedDeltaPaise !== expected[1]) {
    this.invalidate("type", "Ledger deltas must match the movement type and amount.");
  }
});
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ referenceId: 1 });
walletTransactionSchema.index({ idempotencyKey: 1 }, { unique: true });
export type WalletTransactionRecord = InferSchemaType<typeof walletTransactionSchema>;
/** Lean-read shape: `_id` and the create-only `createdAt` timestamp are not in `InferSchemaType`. */
export type WalletTransactionRow = WalletTransactionRecord & { _id: Types.ObjectId; createdAt: Date };
export type WalletTransactionDoc = HydratedDocument<WalletTransactionRecord>;
export const WalletTransaction = modelFor("WalletTransaction", walletTransactionSchema, "walletTransactions");
