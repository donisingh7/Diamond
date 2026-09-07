import { z } from "zod";

/**
 * `POST /api/withdrawals` body — a strict Zod discriminated union on `method`. Every branch is
 * `.strict()`, so the server refuses any client-supplied authoritative value (`status`,
 * `destinationSummary`, `decidedByAdminId`, a raw `userId`, …). `amountPaise` is only guaranteed
 * "a positive whole number" here; the ₹1 minimum and the safe-integer ceiling are the service's
 * job (`assertWithdrawalAmount`) so every future caller of the withdrawal core gets the same
 * checks. The *maximum* is the live available wallet balance and is enforced by the reserve
 * primitive, not by Zod.
 *
 * BANK carries a duplicated `confirmAccountNumber` that MUST equal `accountNumber` (`.refine`)
 * and is NEVER persisted — `toPaymentDetails` drops it and the model sub-schema is
 * `strict: "throw"` as a backstop.
 */

const bankDetailsSchema = z
  .object({
    accountHolderName: z.string().trim().min(2).max(140),
    accountNumber: z.string().trim().regex(/^\d{6,20}$/, "Account number must be 6–20 digits."),
    confirmAccountNumber: z.string().trim().regex(/^\d{6,20}$/),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid 11-character IFSC.")),
    bankName: z.string().trim().min(2).max(140).optional(),
  })
  .strict()
  .refine((value) => value.accountNumber === value.confirmAccountNumber, {
    message: "Account number confirmation does not match.",
    path: ["confirmAccountNumber"],
  });

const upiDetailsSchema = z
  .object({
    upiId: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(
        z
          .string()
          .min(3)
          .max(256)
          .regex(/^[a-z0-9][a-z0-9.\-_]{0,254}@[a-z]{2,64}$/, "Enter a valid UPI ID (name@bank)."),
      ),
  })
  .strict();

const bankWithdrawalSchema = z
  .object({
    method: z.literal("BANK"),
    amountPaise: z.number().int().positive(),
    clientRequestId: z.uuid(),
    bank: bankDetailsSchema,
  })
  .strict();

const upiWithdrawalSchema = z
  .object({
    method: z.literal("UPI"),
    amountPaise: z.number().int().positive(),
    clientRequestId: z.uuid(),
    upi: upiDetailsSchema,
  })
  .strict();

export const createWithdrawalSchema = z.discriminatedUnion("method", [
  bankWithdrawalSchema,
  upiWithdrawalSchema,
]);
export type CreateWithdrawalRequest = z.infer<typeof createWithdrawalSchema>;

/** What actually reaches `withdrawals.paymentDetails` — the duplicated confirmation is dropped. */
export type PersistedPaymentDetails =
  | { accountHolderName: string; accountNumber: string; ifsc: string; bankName?: string }
  | { upiId: string };

export function toPaymentDetails(request: CreateWithdrawalRequest): PersistedPaymentDetails {
  if (request.method === "BANK") {
    const { accountHolderName, accountNumber, ifsc, bankName } = request.bank;
    return bankName ? { accountHolderName, accountNumber, ifsc, bankName } : { accountHolderName, accountNumber, ifsc };
  }
  return { upiId: request.upi.upiId };
}

/** Pre-masked, non-sensitive destination label — the only destination string ever serialised. */
export function buildDestinationSummary(request: CreateWithdrawalRequest): string {
  if (request.method === "BANK") {
    const last4 = request.bank.accountNumber.slice(-4);
    const bank = (request.bank.bankName?.trim() || "Bank").slice(0, 40);
    return `${bank} ••••${last4}`;
  }
  const [handle, psp] = request.upi.upiId.split("@");
  const shownHandle = handle.length <= 2 ? "••" : `${handle.slice(0, 2)}••`;
  return `${shownHandle}@${psp}`;
}

/**
 * `GET /api/withdrawals` query. Bounded pagination only (`limit` 1–50, default 20; opaque
 * `cursor`). Optional `status` filter. `.strict()` rejects stray params.
 */
export const withdrawalsListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).optional(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  })
  .strict();
export type WithdrawalsListQuery = z.infer<typeof withdrawalsListQuerySchema>;

/** `POST /api/withdrawals/[id]/cancel` — no body; `.strict()` so a stray field is `400`. */
export const cancelWithdrawalSchema = z.object({}).strict();
