import { z } from "zod";

export const normalizeLoginId = (value: string) => value.normalize("NFKC").trim().toLowerCase();
export const loginIdSchema = z.string().transform(normalizeLoginId).pipe(z.string().min(1).max(190));
/** Trimmed only; Window 1 does not infer country codes. */
export const normalizePhone = (value: string) => value.trim();
export const phoneSchema = z.string().transform(normalizePhone).pipe(z.string().min(4).max(20));
export const optionalEmailSchema = z.preprocess(
  (value) => typeof value === "string" ? value.trim().toLowerCase() || undefined : value,
  z.email().optional(),
);
