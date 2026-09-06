import { z } from "zod";

export const normalizeLoginId = (value: string) => value.normalize("NFKC").trim().toLowerCase();
export const loginIdSchema = z.string().transform(normalizeLoginId).pipe(z.string().min(1));
export const optionalEmailSchema = z.preprocess(
  (value) => typeof value === "string" ? value.trim().toLowerCase() || undefined : value,
  z.email().optional(),
);
