import { describe, expect, it } from "vitest";
import { assertPaise, formatINR, paiseToRupees, rupeesToPaise, safeAdd, safeMultiply } from "@/lib/money";

describe("integer paise", () => {
  it.each([["1", 100], ["0.01", 1], [" 12.30 ", 1230], ["0", 0], ["90071992547409.91", Number.MAX_SAFE_INTEGER]])("parses %s exactly", (input, expected) => {
    expect(rupeesToPaise(input)).toBe(expected);
  });
  it.each(["-1", "1.001", "1e3", "NaN", "Infinity", "₹10", "1,000", "", ".1", "1.", "90071992547409.92"])("rejects %s", (input) => {
    expect(() => rupeesToPaise(input)).toThrow();
  });
  it("formats without floating point division even at the safe integer limit", () => {
    expect(paiseToRupees(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(formatINR(900000)).toBe("₹9,000.00");
    expect(formatINR(1)).toBe("₹0.01");
  });
  it("checks addition, subtraction and payout multiplication", () => {
    expect(safeAdd(100, 200, -50)).toBe(250);
    expect(safeMultiply(1000, 90)).toBe(90000);
    expect(() => safeAdd(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => safeMultiply(Number.MAX_SAFE_INTEGER, 90)).toThrow();
    expect(() => assertPaise(-1)).toThrow();
    expect(() => assertPaise(1.5)).toThrow();
    expect(() => safeMultiply(100, 1.1)).toThrow();
  });
});
