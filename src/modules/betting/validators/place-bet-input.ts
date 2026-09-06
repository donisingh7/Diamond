import { z } from "zod";
import { marketSlugSchema } from "@/modules/markets/validators/market-query";
import { selectionNumberSchema, type EntryInput } from "./bet-input";

/**
 * `POST /api/bets` body. It is the Window 4A1 quote body plus a `clientRequestId`, and it
 * uses the SAME field names (`marketSlug`, `entryMethod`, `numbers` / `digits` / `rawInput` +
 * `palti`, `stakePaise`) as `quoteRequestSchema` so quote and placement never drift.
 *
 * Discriminated on `entryMethod`; every branch is `.strict()`, so the server refuses any
 * client-supplied authoritative value — `totalStakePaise`, `selectionCount`, `selections`,
 * `payoutMultiplier`, `marketRoundId`, `payout`, `publicRef`, wallet balance — those are all
 * server-derived (DOMAIN_RULES / Window 4A3 §3).
 */
const stakePaiseSchema = z.number().int().positive();
const clientRequestIdSchema = z.uuid();

export const placeBetRequestSchema = z.discriminatedUnion("entryMethod", [
  z
    .object({
      marketSlug: marketSlugSchema,
      entryMethod: z.literal("JODI"),
      numbers: z.array(selectionNumberSchema).min(1).max(100),
      stakePaise: stakePaiseSchema,
      clientRequestId: clientRequestIdSchema,
    })
    .strict(),
  z
    .object({
      marketSlug: marketSlugSchema,
      entryMethod: z.literal("CROSSING"),
      digits: z.string().regex(/^\d+$/).max(100),
      stakePaise: stakePaiseSchema,
      clientRequestId: clientRequestIdSchema,
    })
    .strict(),
  z
    .object({
      marketSlug: marketSlugSchema,
      entryMethod: z.literal("COPY_PASTE"),
      rawInput: z.string().min(1).max(2000),
      palti: z.boolean(),
      stakePaise: stakePaiseSchema,
      clientRequestId: clientRequestIdSchema,
    })
    .strict(),
]);

export type PlaceBetRequest = z.infer<typeof placeBetRequestSchema>;

/** Narrow the HTTP request to the method-specific engine input the shared normalizer expects. */
export function toPlaceEntryInput(request: PlaceBetRequest): EntryInput {
  switch (request.entryMethod) {
    case "JODI":
      return { entryMethod: "JODI", numbers: request.numbers };
    case "CROSSING":
      return { entryMethod: "CROSSING", digits: request.digits };
    case "COPY_PASTE":
      return { entryMethod: "COPY_PASTE", rawInput: request.rawInput, palti: request.palti };
  }
}
