import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { getSessionSecret } from "@/lib/config/env";

export interface OtpDelivery { userId: string; requestId: string; code: string }
export interface OtpProvider { send(input: OtpDelivery): Promise<void> }

/** Explicit injected sink: no console logging, persisted plaintext, or public code endpoint. */
export class MockOtpProvider implements OtpProvider {
  constructor(private readonly deliver: (input: OtpDelivery) => Promise<void>) {}
  async send(input: OtpDelivery): Promise<void> { await this.deliver(input); }
}

export function generateOtpCode(): string { return randomInt(0, 1_000_000).toString().padStart(6, "0"); }
export function hashOtpCode(requestId: string, code: string): string {
  return createHmac("sha256", getSessionSecret()).update(`${requestId}:${code}`).digest("hex");
}
