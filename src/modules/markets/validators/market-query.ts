import { z } from "zod";

/** Same shape markets.slug is stored in; forgiving about caller casing/whitespace. */
export const marketSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));

export const resultRangeSchema = z.enum(["today", "7d", "30d"]);
export type ResultRange = z.infer<typeof resultRangeSchema>;
export type ResultHistoryRange = Exclude<ResultRange, "today">;

/** GET /api/results query. `.strict()` rejects stray params so an oversized/unbounded query can't slip through. */
export const resultsQuerySchema = z
  .object({
    range: resultRangeSchema.default("today"),
    market: marketSlugSchema.optional(),
  })
  .strict();
export type ResultsQuery = z.infer<typeof resultsQuerySchema>;
