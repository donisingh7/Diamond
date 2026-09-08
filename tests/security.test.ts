import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { hashOtpCode, MockOtpProvider } from "@/modules/auth/providers/otp-provider";
import { assertDevelopmentReset } from "../scripts/reset-safeguards";
import { DomainError, toPublicError } from "@/lib/errors/domain-error";
import { getDatabaseEnv, getSessionSecret } from "@/lib/config/env";
import { SetupError } from "@/lib/errors/setup-error";

describe("security foundations", () => {
  it("accepts only explicit valid DNS override addresses", () => {
    vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1:27017/diamond_test");
    vi.stubEnv("MONGODB_DNS_SERVERS", "1.1.1.1, 8.8.8.8");
    try {
      expect(getDatabaseEnv().MONGODB_DNS_SERVERS).toEqual(["1.1.1.1", "8.8.8.8"]);
      vi.stubEnv("MONGODB_DNS_SERVERS", "resolver.example.com");
      expect(() => getDatabaseEnv()).toThrow();
      vi.stubEnv("MONGODB_DNS_SERVERS", "");
      expect(getDatabaseEnv().MONGODB_DNS_SERVERS).toBeUndefined();
    } finally { vi.unstubAllEnvs(); }
  });
  it("salts password hashes and verifies only the correct password", async () => {
    const password = "test-fixture-password";
    const first = await hashPassword(password); const second = await hashPassword(password);
    expect(first).not.toBe(second); expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword("wrong", first)).toBe(false);
    expect(await verifyPassword(password, "malformed")).toBe(false);
  });
  it("hashes OTP with a secret and request scope; mock delivery uses explicit sink", async () => {
    vi.stubEnv("SESSION_SECRET", "test-only-secret-with-at-least-32-characters");
    try {
      expect(hashOtpCode("a", "123456")).not.toBe(hashOtpCode("b", "123456"));
      const sink = vi.fn(async () => {});
      await new MockOtpProvider(sink).send({ userId: "u", requestId: "a", code: "123456" });
      expect(sink).toHaveBeenCalledOnce();
    } finally { vi.unstubAllEnvs(); }
  });
  it("fails closed on a missing or too-short SESSION_SECRET with static setup guidance, not the value", () => {
    try {
      vi.stubEnv("SESSION_SECRET", "");
      expect(() => getSessionSecret()).toThrow(SetupError);
      vi.stubEnv("SESSION_SECRET", "too-short");
      const shortSecret = "too-short";
      try {
        getSessionSecret();
        expect.unreachable("getSessionSecret must throw for a short secret");
      } catch (error) {
        expect(error).toBeInstanceOf(SetupError);
        expect((error as SetupError).message).not.toContain(shortSecret);
        expect((error as SetupError).message).toContain("at least 32 characters");
      }
      vi.stubEnv("SESSION_SECRET", "test-only-secret-with-at-least-32-characters");
      expect(getSessionSecret()).toBe("test-only-secret-with-at-least-32-characters");
    } finally { vi.unstubAllEnvs(); }
  });
  it("refuses resets without all three independent safeguards", () => {
    expect(() => assertDevelopmentReset("development", "diamond_dev", ["--confirm", "diamond_dev"])).not.toThrow();
    for (const env of [undefined, "production", "test"]) expect(() => assertDevelopmentReset(env, "diamond_dev", ["--confirm", "diamond_dev"])).toThrow();
    expect(() => assertDevelopmentReset("development", "diamond", ["--confirm", "diamond"])).toThrow();
    expect(() => assertDevelopmentReset("development", "diamond_dev", ["--confirm", "diamond_dev_other"])).toThrow();
    expect(() => assertDevelopmentReset("development", "diamond_dev", [])).toThrow();
  });
  it("does not return raw database errors", () => {
    expect(toPublicError(new Error("sensitive database detail")).message).not.toContain("sensitive");
    expect(toPublicError(new DomainError("MARKET_CLOSED", "Market is closed."))).toEqual({ code: "MARKET_CLOSED", message: "Market is closed." });
  });
});
