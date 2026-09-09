import { z } from "zod";
import { rupeesToPaise } from "@/lib/money";

// Frontend wire contracts from Window 10A (2fe96e1). The backend is integrated separately.
export type PaymentSnapshot = {
  type: "UPI" | "BANK"; displayName: string; instructions: string | null;
  upiId: string | null; accountHolderName: string | null; bankName: string | null;
  accountNumberMasked: string | null; ifsc: string | null;
};
export type PlayerPaymentMethod = Omit<PaymentSnapshot, "accountNumberMasked"> & {
  id: string; sortOrder: number; qrImageId: string | null; accountNumber: string | null;
};
export type AdminPaymentMethod = PaymentSnapshot & {
  id: string; sortOrder: number; qrImageId: string | null; isActive: boolean;
  createdAt: string; updatedAt: string;
};
export type Deposit = {
  id: string; status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAmountPaise: number; approvedAmountPaise: number | null;
  paymentMethodId: string; paymentMethodSnapshot: PaymentSnapshot;
  utr: string; proofImageId: string; adminRemark: string | null;
  submittedAt: string; reviewedAt: string | null; createdAt: string; updatedAt: string;
};
export type AdminDeposit = Deposit & { userId: string; reviewedByAdminId: string | null };
export type DepositPage<T = Deposit> = { deposits: T[]; nextCursor: string | null };

const id = z.string().regex(/^[a-f0-9]{24}$/i, "Choose a valid payment method and upload an image.");
const amount = z.number().int().positive();
export const depositSubmission = z.object({
  paymentMethodId: id, requestedAmountPaise: amount,
  utr: z.string().trim().min(4).max(64).regex(/^[A-Za-z0-9 \-]+$/, "UTR may contain only letters, digits, spaces and hyphens."),
  proofImageId: id, clientRequestId: z.uuid(),
}).strict();
export type DepositSubmission = z.infer<typeof depositSubmission>;
const commonMethod = {
  displayName: z.string().trim().min(2).max(120), instructions: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(), sortOrder: z.number().int().min(-100000).max(100000).optional(),
};
const upi = {
  upiId: z.string().trim().toLowerCase().pipe(z.string().min(3).max(256).regex(/^[a-z0-9][a-z0-9.\-_]{0,254}@[a-z]{2,64}$/, "Enter a valid UPI ID (name@bank).")),
  qrImageId: id.optional(),
};
const bank = {
  accountHolderName: z.string().trim().min(2).max(140), bankName: z.string().trim().min(2).max(140),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/, "Account number must be 6–20 digits."),
  ifsc: z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid 11-character IFSC.")),
};
export const createMethodInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("UPI"), ...commonMethod, ...upi }).strict(),
  z.object({ type: z.literal("BANK"), ...commonMethod, ...bank }).strict(),
]);
export const updateMethodInput = z.object({ ...commonMethod, ...upi, ...bank }).partial().strict();
export function positiveAmount(value: string) {
  const paise = rupeesToPaise(value);
  if (paise <= 0) throw new Error("Enter an amount greater than zero.");
  return paise;
}
export function approvalInput(value: string, requested: number, remark: string, clientRequestId: string) {
  const approvedAmountPaise = positiveAmount(value);
  const adminRemark = remark.trim();
  if (approvedAmountPaise !== requested && !adminRemark) throw new Error("An Admin remark is required when the approved amount differs from the requested amount.");
  return z.object({ approvedAmountPaise: amount, adminRemark: z.string().trim().min(1).max(1000).optional(), clientRequestId: z.uuid() }).strict()
    .parse({ approvedAmountPaise, ...(adminRemark ? { adminRemark } : {}), clientRequestId });
}
export const rejectionInput = z.object({ adminRemark: z.string().trim().min(1, "Enter a rejection remark.").max(1000), clientRequestId: z.uuid() }).strict();
export function maskedUtr(value: string) { return `••••${value.replace(/[^A-Za-z0-9]/g, "").slice(-4)}`; }
