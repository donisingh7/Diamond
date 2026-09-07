import { z } from "zod";
import { marketSlugSchema } from "@/modules/markets/validators/market-query";

/**
 * `GET /api/bets` query. Bounded pagination only (API_CONTRACTS.md "List routes use opaque
 * cursor/limit pagination … do not create unbounded histories") — `limit` defaults to 20 and is
 * capped at 50; `cursor` is the opaque token from a previous page. Optional `status` / `market`
 * filters narrow the player's own history. `.strict()` rejects stray params.
 */
export const betsListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).optional(),
    status: z.enum(["ACTIVE", "WON", "LOST"]).optional(),
    market: marketSlugSchema.optional(),
  })
  .strict();
export type BetsListQuery = z.infer<typeof betsListQuerySchema>;
