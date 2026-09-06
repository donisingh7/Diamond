import { describe, expect, it, vi } from "vitest";
import { generateSessionToken, hashSessionToken } from "@/modules/auth/services/session.service";

describe("session token primitives", () => {
  it("generates high-entropy, unique raw tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
  it("hashes deterministically without revealing the raw token", () => {
    vi.stubEnv("SESSION_SECRET", "test-only-secret-with-at-least-32-characters");
    try {
      const token = generateSessionToken();
      const first = hashSessionToken(token);
      const second = hashSessionToken(token);
      expect(first).toBe(second);
      expect(first).not.toBe(token);
      expect(hashSessionToken(generateSessionToken())).not.toBe(first);
    } finally { vi.unstubAllEnvs(); }
  });
});
