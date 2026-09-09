import { z } from "zod";

/**
 * Window 10A — strict Zod for the Add Money surface (payment methods + deposit requests).
 * Every schema is `.strict()`: a client can never smuggle `status`, `approvedAmountPaise` on a
 * submit, `normalizedUtr`, `reviewedByAdminId`, a resulting balance, or a raw `userId` — the
 * server forces all of those.
 */

const hex24 = z.string().regex(/^[a-f0-9]{24}$/i, "Expected a 24-character hex id.");
const uuid = z.uuid();
const amountPaise = z.number().int().positive();
const displayName = z.string().trim().min(2).max(120);
const instructions = z.string().trim().max(2000).optional();
const sortOrder = z.number().int().min(-100000).max(100000).optional();

const upiId = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.string().min(3).max(256).regex(/^[a-z0-9][a-z0-9.\-_]{0,254}@[a-z]{2,64}$/, "Enter a valid UPI ID (name@bank)."));
const accountNumber = z.string().trim().regex(/^\d{6,20}$/, "Account number must be 6–20 digits.");
const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid 11-character IFSC."));
const accountHolderName = z.string().trim().min(2).max(140);
const bankName = z.string().trim().min(2).max(140);

// --- admin: create a payment method ------------------------------------------------------

export const createPaymentMethodSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("UPI"),
      displayName,
      upiId,
      qrImageId: hex24.optional(),
      instructions,
      isActive: z.boolean().optional(),
      sortOrder,
    })
    .strict(),
  z
    .object({
      type: z.literal("BANK"),
      displayName,
      accountHolderName,
      bankName,
      accountNumber,
      ifsc,
      instructions,
      isActive: z.boolean().optional(),
      sortOrder,
    })
    .strict(),
]);
export type CreatePaymentMethodRequest = z.infer<typeof createPaymentMethodSchema>;

// --- admin: update a payment method (type is immutable) --------------------------------

export const updatePaymentMethodSchema = z
  .object({
    displayName: displayName.optional(),
    instructions: z.string().trim().max(2000).optional(),
    isActive: z.boolean().optional(),
    sortOrder,
    upiId: upiId.optional(),
    qrImageId: hex24.optional(),
    accountHolderName: accountHolderName.optional(),
    bankName: bankName.optional(),
    accountNumber: accountNumber.optional(),
    ifsc: ifsc.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required." });
export type UpdatePaymentMethodRequest = z.infer<typeof updatePaymentMethodSchema>;

// --- player: submit a deposit request -------------------------------------------------

/** Raw UTR: 4–64 chars of letters, digits, spaces or hyphens. Normalized separately. */
const rawUtr = z.string().trim().min(4).max(64).regex(/^[A-Za-z0-9 \-]+$/, "UTR may contain only letters, digits, spaces and hyphens.");

export const submitDepositSchema = z
  .object({
    paymentMethodId: hex24,
    requestedAmountPaise: amountPaise,
    utr: rawUtr,
    proofImageId: hex24,
    clientRequestId: uuid,
  })
  .strict();
export type SubmitDepositRequest = z.infer<typeof submitDepositSchema>;

// --- admin: review a deposit request -------------------------------------------------

const adminRemark = z.string().trim().min(1).max(1000);

export const approveDepositSchema = z
  .object({
    approvedAmountPaise: amountPaise,
    adminRemark: adminRemark.optional(),
    clientRequestId: uuid,
  })
  .strict();
export type ApproveDepositRequest = z.infer<typeof approveDepositSchema>;

export const rejectDepositSchema = z
  .object({
    adminRemark,
    clientRequestId: uuid,
  })
  .strict();
export type RejectDepositRequest = z.infer<typeof rejectDepositSchema>;

// --- list queries ------------------------------------------------------------------

export const playerDepositsQuerySchema = z
  .object({
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type PlayerDepositsQuery = z.infer<typeof playerDepositsQuerySchema>;

export const adminDepositsQuerySchema = z
  .object({
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
    userId: hex24.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type AdminDepositsQuery = z.infer<typeof adminDepositsQuerySchema>;

// --- pure helpers -----------------------------------------------------------------

/** Upper-case, strip every non-alphanumeric. The dedupe key for "same bank transfer". */
export function normalizeUtr(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "••••1234" — the only form of an account number that leaves the admin config. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return `••••${last4}`;
}
