import { describe, expect, it } from "vitest";
import { formatCountdown } from "@/components/ui/countdown";

/** Presentation-only formatting; the caller (server-derived instants) decides real eligibility. */
describe("formatCountdown", () => {
  it("formats whole hours/minutes/seconds remaining", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(formatCountdown(now + 3661_000, now)).toBe("01 : 01 : 01");
    expect(formatCountdown(now + 59_000, now)).toBe("00 : 00 : 59");
  });
  it("clamps to zero once the target has passed", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(formatCountdown(now - 5_000, now)).toBe("00 : 00 : 00");
  });
  it("shows a placeholder for a non-finite target or clock", () => {
    expect(formatCountdown(Number.NaN, Date.now())).toBe("-- : -- : --");
    expect(formatCountdown(Date.now(), Number.NaN)).toBe("-- : -- : --");
  });
});
