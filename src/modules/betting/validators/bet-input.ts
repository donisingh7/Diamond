import { z } from "zod";

export const selectionNumberSchema = z.string().regex(/^\d{2}$/);
export const entryMethodSchema = z.enum(["JODI", "CROSSING", "COPY_PASTE"]);
export const entryInputSchema = z.discriminatedUnion("entryMethod", [
  z.object({ entryMethod: z.literal("JODI"), numbers: z.array(selectionNumberSchema).min(1).max(100) }).strict(),
  z.object({ entryMethod: z.literal("CROSSING"), digits: z.string().regex(/^\d+$/) }).strict(),
  z.object({ entryMethod: z.literal("COPY_PASTE"), rawInput: z.string().min(1), palti: z.boolean() }).strict(),
]);
export type EntryInput = z.infer<typeof entryInputSchema>;
export type NormalizedSelection = { number: string; stakePaise: number };
