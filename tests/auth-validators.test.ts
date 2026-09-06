import { describe, expect, it } from "vitest";
import { loginRequestSchema, otpRequestSchema, otpVerifySchema } from "@/modules/auth/validators/auth-input";

describe("auth request validators", () => {
  it("normalizes login id and requires an explicit portal", () => {
    const parsed = loginRequestSchema.parse({ portal: "PLAYER", loginId: " ＰLayer1 ", password: "x" });
    expect(parsed.loginId).toBe("player1");
    expect(() => loginRequestSchema.parse({ loginId: "a", password: "x" })).toThrow();
    expect(() => loginRequestSchema.parse({ portal: "SUPERADMIN", loginId: "a", password: "x" })).toThrow();
    expect(() => loginRequestSchema.parse({ portal: "PLAYER", loginId: "a", password: "" })).toThrow();
  });
  it("trims phone numbers without inferring a country code", () => {
    expect(otpRequestSchema.parse({ phone: " 9876543210 " }).phone).toBe("9876543210");
    expect(() => otpRequestSchema.parse({ phone: "12" })).toThrow();
  });
  it("requires exactly six digits for an OTP code", () => {
    expect(otpVerifySchema.parse({ requestId: "abc", code: "123456" }).code).toBe("123456");
    expect(() => otpVerifySchema.parse({ requestId: "abc", code: "12345" })).toThrow();
    expect(() => otpVerifySchema.parse({ requestId: "abc", code: "abcdef" })).toThrow();
  });
});
