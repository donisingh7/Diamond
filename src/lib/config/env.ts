import "server-only";
import { z } from "zod";
import { isIP } from "node:net";
import { SetupError } from "../errors/setup-error";

export function getDatabaseEnv() {
  return z.object({
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
    MONGODB_DNS_SERVERS: z.preprocess(
      (value) => typeof value === "string" && value.trim() ? value.split(",").map((part) => part.trim()) : undefined,
      z.array(z.string().refine((value) => isIP(value) !== 0, "Use DNS server IP addresses.")).min(1).optional(),
    ),
  }).parse(process.env);
}

/**
 * The HMAC pepper for session and OTP hashing. A missing or too-short `SESSION_SECRET` is a
 * deployment misconfiguration, not user input — surface static operational guidance (never the
 * value) instead of a raw ZodError, while still failing closed: this throws, so no session or
 * OTP hash is ever produced without a valid secret.
 */
export function getSessionSecret(): string {
  const parsed = z.string().min(32).safeParse(process.env.SESSION_SECRET);
  if (!parsed.success) {
    throw new SetupError("SESSION_SECRET must be set to a string of at least 32 characters.");
  }
  return parsed.data;
}

export function getSeedAdminEnv() {
  return z.object({
    SEED_ADMIN_LOGIN_ID: z.string().trim().min(1),
    SEED_ADMIN_PASSWORD: z.string().min(12).max(1024),
  }).parse(process.env);
}

/**
 * Environment for `scripts/seed-demo.ts` ONLY. Never imported by the application. `DEMO_SEED_ENABLED`
 * must be exactly `"true"` — the explicit safety flag that keeps the demo seed from ever running by
 * accident (it is NOT wired into app startup). Passwords are supplied here, never committed to
 * source or docs; `.env.example` carries blank placeholders only. No strength policy is imposed —
 * the demo credentials are intentionally simple and are not production password policy.
 */
export function getDemoSeedEnv() {
  return z.object({
    DEMO_SEED_ENABLED: z.literal("true"),
    DEMO_PLAYER_PHONE: z.string().trim().min(4).max(20),
    DEMO_PLAYER_PASSWORD: z.string().min(1).max(1024),
    DEMO_ADMIN_DONI_PASSWORD: z.string().min(1).max(1024),
    DEMO_ADMIN_PANKAJ_PASSWORD: z.string().min(1).max(1024),
    DEMO_ADMIN_GOPAL_PASSWORD: z.string().min(1).max(1024),
  }).parse(process.env);
}
