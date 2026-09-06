import { existsSync } from "node:fs";
import mongoose from "mongoose";
import { SetupError } from "../src/lib/errors/setup-error";

/** Shell environment wins, then .env.local, then .env. Never print environment values. */
export function loadEnvironment(): void {
  for (const path of [".env.local", ".env"]) if (existsSync(path)) process.loadEnvFile(path);
}

export async function runScript(work: () => Promise<void>): Promise<void> {
  try { loadEnvironment(); await work(); }
  catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      && /^[A-Z0-9_]+$/.test(String(error.code)) ? `/${String(error.code)}` : "";
    console.error(error instanceof SetupError ? error.message : `Command failed (${error instanceof Error ? error.name : "UnknownError"}${code}). Check required environment, database permissions, indexes and replica-set configuration. No sensitive error values printed.`);
    process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
