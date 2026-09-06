import { describe, expect, it } from "vitest";
import { isRouteActive } from "@/components/shared/navigation";

describe("isRouteActive", () => {
  it("matches the root item only on an exact path", () => {
    expect(isRouteActive("/", "/", true)).toBe(true);
    expect(isRouteActive("/results", "/", true)).toBe(false);
  });
  it("matches non-root items on exact path or nested sub-route", () => {
    expect(isRouteActive("/my-bets", "/my-bets")).toBe(true);
    expect(isRouteActive("/my-bets/abc123/edit", "/my-bets")).toBe(true);
    expect(isRouteActive("/wallet", "/my-bets")).toBe(false);
  });
  it("does not treat a similarly-prefixed sibling route as active", () => {
    expect(isRouteActive("/results-archive", "/results")).toBe(false);
  });
  it("respects an explicit exact flag on non-root items", () => {
    expect(isRouteActive("/admin/players/new", "/admin/players", true)).toBe(false);
    expect(isRouteActive("/admin/players", "/admin/players", true)).toBe(true);
  });
});
