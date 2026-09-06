import { z } from "zod";
import { marketSlugSchema } from "@/modules/markets/validators/market-query";
import { selectionNumberSchema, type EntryInput } from "./bet-input";

/**
 * Common stake for every generated/selected number, as an integer number of paise. Window 4A1
 * takes paise directly (a deliberate, documented refinement of the original API_CONTRACTS
 * `stakeRupees` sketch — see API_CONTRACTS.md "Window 4A1"). The domain minimum
 * (`platformSettings.minimumStakePaise`) is enforced by the engine, not here, so a
 * below-minimum stake produces `STAKE_BELOW_MINIMUM` (422) rather than a generic 400.
 */
const stakePaiseSchema = z.number().int().positive();

/**
 * `POST /api/bets/quote` body. Discriminated on `entryMethod`; every branch is `.strict()`
 * so an irrelevant cross-method field (e.g. `digits` on a JODI request, or `palti` on
 * CROSSING) is rejected rather than silently ignored.
 */
export const quoteRequestSchema = z.discriminatedUnion("entryMethod", [
  z
    .object({
      marketSlug: marketSlugSchema,
      entryMethod: z.literal("JODI"),
      numbers: z.array(selectionNumberSchema).min(1).max(100),
      stakePaise: stakePaiseSchema,
    })
    .strict(),
  z
    .object({
      marketSlug: marketSlugSchema,
      entryMethod: z.literal("CROSSING"),
      digits: z.string().regex(/^\d+$/).max(100),
      stakePaise: stakePaiseSchema,
    })
    .strict(),
  z
    .object({
      marketSlug: marketSlugSchema,
      entryMethod: z.literal("COPY_PASTE"),
      rawInput: z.string().min(1).max(2000),
      palti: z.boolean(),
      stakePaise: stakePaiseSchema,
    })
    .strict(),
]);

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

/** Narrow the HTTP request to the method-specific engine input the pure normalizer expects. */
export function toEntryInput(request: QuoteRequest): EntryInput {
  switch (request.entryMethod) {
    case "JODI":
      return { entryMethod: "JODI", numbers: request.numbers };
    case "CROSSING":
      return { entryMethod: "CROSSING", digits: request.digits };
    case "COPY_PASTE":
      return { entryMethod: "COPY_PASTE", rawInput: request.rawInput, palti: request.palti };
  }
}
