import { Schema } from "mongoose";
import { modelFor, schemaOptions, userRef, optionalUserRef, positivePaise, requiredText } from "@/lib/db/schema";

const paymentDetailsSchema = new Schema({
  accountHolderName: String, accountNumber: String, ifsc: String, bankName: String, upiId: String,
}, { _id: false, strict: "throw" });
export const withdrawalSchema = new Schema({
  userId: userRef,
  clientRequestId: requiredText,
  amountPaise: positivePaise,
  method: { type: String, enum: ["BANK", "UPI"], required: true },
  paymentDetails: { type: paymentDetailsSchema, required: true, select: false },
  status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"], default: "PENDING", required: true },
  rejectionReason: String,
  requestedAt: { type: Date, required: true },
  decidedAt: Date,
  decidedByAdminId: optionalUserRef,
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
export const Withdrawal = modelFor("Withdrawal", withdrawalSchema, "withdrawals");
