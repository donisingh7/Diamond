import { z } from "zod";
import { loginIdSchema, optionalEmailSchema, phoneSchema } from "@/modules/users/validators/identity";

/**
 * Strict Zod for every Window 6A1 admin route. `.strict()` everywhere: a client cannot smuggle
 * `role`, `status`, `passwordHash`, a resulting `balance`, `userId`, `createdBy` or any other
 * authoritative field — the server forces them. No password strength policy is imposed in V1
 * (only the `hashPassword` bounds: non-empty, ≤ 1024 chars); the simple demo credentials the
 * deployment seed uses must remain acceptable and this is NOT production password policy
 * (DEMO password security note, brief §7).
 */

const passwordSchema = z.string().min(1).max(1024);
const nameSchema = z.string().trim().min(1).max(190);

/** `POST /api/admin/players`. Role is server-forced PLAYER; `status` defaults ACTIVE. */
export const createPlayerSchema = z
  .object({
    loginId: loginIdSchema,
    name: nameSchema,
    password: passwordSchema,
    phone: phoneSchema.optional(),
    email: optionalEmailSchema,
  })
  .strict();
export type CreatePlayerRequest = z.infer<typeof createPlayerSchema>;

/** `GET /api/admin/players` query. Bounded list; `search` matches normalized identity fields only. */
export const listPlayersQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(190).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type ListPlayersQuery = z.infer<typeof listPlayersQuerySchema>;

/** `POST /api/admin/players/[id]/status` — enable / disable a PLAYER. */
export const setPlayerStatusSchema = z
  .object({ status: z.enum(["ACTIVE", "DISABLED"]) })
  .strict();
export type SetPlayerStatusRequest = z.infer<typeof setPlayerStatusSchema>;

/** `POST /api/admin/players/[id]/reset-password`. The new password is hashed, never echoed. */
export const resetPlayerPasswordSchema = z
  .object({ newPassword: passwordSchema })
  .strict();
export type ResetPlayerPasswordRequest = z.infer<typeof resetPlayerPasswordSchema>;

/**
 * `POST /api/admin/players/[id]/wallet/credit` and `.../debit`. `amountPaise` is only
 * "a positive whole number" here; the ₹1 minimum and safe-integer ceiling are the service's job
 * (`assertMovementAmount` in the wallet core). `reason` is REQUIRED. A resulting balance is
 * never accepted — the server computes it.
 */
export const adminWalletAdjustmentSchema = z
  .object({
    amountPaise: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
    paymentReference: z.string().trim().min(1).max(200).optional(),
    clientRequestId: z.uuid(),
  })
  .strict();
export type AdminWalletAdjustmentRequest = z.infer<typeof adminWalletAdjustmentSchema>;

/** `GET /api/admin/players/[id]/wallet/transactions` query — bounded, newest first. */
export const adminWalletTransactionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type AdminWalletTransactionsQuery = z.infer<typeof adminWalletTransactionsQuerySchema>;

/** `GET /api/admin/players/[id]/bets` query — reuses the player bet-read service (sanitized DTO). */
export const adminPlayerBetsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).optional(),
    status: z.enum(["ACTIVE", "WON", "LOST"]).optional(),
    market: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
export type AdminPlayerBetsQuery = z.infer<typeof adminPlayerBetsQuerySchema>;

/** `GET /api/admin/players/[id]/withdrawals` query — reuses the player withdrawal read service. */
export const adminPlayerWithdrawalsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).optional(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  })
  .strict();
export type AdminPlayerWithdrawalsQuery = z.infer<typeof adminPlayerWithdrawalsQuerySchema>;
