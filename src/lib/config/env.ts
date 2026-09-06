import "server-only";
import { z } from "zod";
import { isIP } from "node:net";

export function getDatabaseEnv() {
  return z.object({
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
    MONGODB_DNS_SERVERS: z.preprocess(
      (value) => typeof value === "string" && value.trim() ? value.split(",").map((part) => part.trim()) : undefined,
      z.array(z.string().refine((value) => isIP(value) !== 0, "Use DNS server IP addresses.")).min(1).optional(),
    ),
  }).parse(process.env);
}

export function getSessionSecret(): string {
  return z.string().min(32).parse(process.env.SESSION_SECRET);
}

export function getSeedAdminEnv() {
  return z.object({
    SEED_ADMIN_LOGIN_ID: z.string().trim().min(1),
    SEED_ADMIN_PASSWORD: z.string().min(12).max(1024),
  }).parse(process.env);
}
