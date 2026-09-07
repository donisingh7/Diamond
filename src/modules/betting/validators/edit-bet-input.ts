import { z } from "zod";
import { selectionNumberSchema, type EntryInput } from "./bet-input";

/**
 * `PATCH /api/bets/[id]` body — a WHOLE-wager replacement (DOMAIN_RULES.md "BET EDITING": add /
 * remove selections, change stake, change the whole composition, reconstruct the entry method,
 * change Jodi / Crossing / Copy Paste / Palti input). It re-uses the SAME field names as
 * `placeBetRequestSchema` for the method-specific input, so quote / placement / edit never drift
 * to different parsers — the one difference is that editing carries `expectedVersion` +
 * `editRequestId` instead of `clientRequestId`, and it does NOT carry `marketSlug`: an edit
 * cannot move a bet to a different market or round (that would be a new bet — Window 4A4 §3).
 *
 * Discriminated on `entryMethod`; every branch is `.strict()`, so the server refuses any
 * client-supplied authoritative value — `totalStakePaise`, `selectionCount`, `selections`,
 * `payoutMultiplier`, `version`, `publicRef`, `marketSlug`, wallet balance — all server-derived.
 */
const stakePaiseSchema = z.number().int().positive();
/** The client's view of the bet version the edit is based on — optimistic-concurrency guard. */
const expectedVersionSchema = z.number().int().min(1);
/** Client-generated UUID making a retried edit idempotent (Window 4A4 §9). */
const editRequestIdSchema = z.uuid();

export const editBetRequestSchema = z.discriminatedUnion("entryMethod", [
  z
    .object({
      entryMethod: z.literal("JODI"),
      numbers: z.array(selectionNumberSchema).min(1).max(100),
      stakePaise: stakePaiseSchema,
      expectedVersion: expectedVersionSchema,
      editRequestId: editRequestIdSchema,
    })
    .strict(),
  z
    .object({
      entryMethod: z.literal("CROSSING"),
      digits: z.string().regex(/^\d+$/).max(100),
      stakePaise: stakePaiseSchema,
      expectedVersion: expectedVersionSchema,
      editRequestId: editRequestIdSchema,
    })
    .strict(),
  z
    .object({
      entryMethod: z.literal("COPY_PASTE"),
      rawInput: z.string().min(1).max(2000),
      palti: z.boolean(),
      stakePaise: stakePaiseSchema,
      expectedVersion: expectedVersionSchema,
      editRequestId: editRequestIdSchema,
    })
    .strict(),
]);

export type EditBetRequest = z.infer<typeof editBetRequestSchema>;

/** Narrow the HTTP request to the method-specific engine input the shared normalizer expects. */
export function toEditEntryInput(request: EditBetRequest): EntryInput {
  switch (request.entryMethod) {
    case "JODI":
      return { entryMethod: "JODI", numbers: request.numbers };
    case "CROSSING":
      return { entryMethod: "CROSSING", digits: request.digits };
    case "COPY_PASTE":
      return { entryMethod: "COPY_PASTE", rawInput: request.rawInput, palti: request.palti };
  }
}
