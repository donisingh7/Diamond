import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isTrustedOrigin } from "@/lib/http/same-origin";

function requestWithOrigin(origin: string | null) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new NextRequest("http://localhost:3000/api/auth/login", { method: "POST", headers });
}

describe("isTrustedOrigin", () => {
  it("allows a request with no Origin header", () => {
    expect(isTrustedOrigin(requestWithOrigin(null))).toBe(true);
  });
  it("allows a same-origin Origin header", () => {
    expect(isTrustedOrigin(requestWithOrigin("http://localhost:3000"))).toBe(true);
  });
  it("rejects a cross-origin Origin header", () => {
    expect(isTrustedOrigin(requestWithOrigin("https://evil.example.com"))).toBe(false);
  });
  it("rejects a malformed Origin header", () => {
    expect(isTrustedOrigin(requestWithOrigin("not-a-url"))).toBe(false);
  });
});
