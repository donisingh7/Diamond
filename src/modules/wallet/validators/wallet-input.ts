import { z } from "zod";

/**
 * `POST /api/wallet/mock-deposit` body. `amountPaise` is an integer number of paise (Window 4A2
 * is integer-paise end to end). Zod only guarantees "a positive whole number"; the ₹1 minimum
 * and safe-integer ceiling are enforced by the service (`assertMockDepositAmount`) so every
 * future caller of the wallet core gets the same checks, not just this route. `clientRequestId`
 * is a client-generated UUID — the same id repeated credits only once, two different ids are
 * two intentional deposits.
 */
export const mockDepositSchema = z
  .object({
    amountPaise: z.number().int().positive(),
    clientRequestId: z.uuid(),
  })
  .strict();
export type MockDepositRequest = z.infer<typeof mockDepositSchema>;

/**
 * `GET /api/wallet/transactions` query. Bounded pagination only — `limit` defaults to 20 and is
 * capped at 100; `cursor` is the opaque token from a previous page. `.strict()` rejects stray
 * params.
 */
export const walletTransactionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type WalletTransactionsQuery = z.infer<typeof walletTransactionsQuerySchema>;
