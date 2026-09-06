import { DomainError } from "../errors/domain-error";

const maxInteger = BigInt(Number.MAX_SAFE_INTEGER);

export function assertSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new DomainError("MONEY_OUT_OF_RANGE", "Amount exceeds supported integer precision.");
  }
  return value;
}

export function assertPaise(value: number): number {
  assertSafeInteger(value);
  if (value < 0) throw new DomainError("INVALID_INPUT", "Amount cannot be negative.");
  return value;
}

function fromBigInt(value: bigint): number {
  if (value > maxInteger || value < -maxInteger) {
    throw new DomainError("MONEY_OUT_OF_RANGE", "Amount exceeds supported integer precision.");
  }
  return Number(value);
}

/** Decimal text only: no exponent, currency symbols, grouping, or rounding. */
export function rupeesToPaise(input: string): number {
  const value = input.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || value.length > 32) {
    throw new DomainError("INVALID_INPUT", "Enter a non-negative amount with at most two decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  return fromBigInt(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
}

export function safeAdd(...values: number[]): number {
  return fromBigInt(values.reduce((sum, value) => sum + BigInt(assertSafeInteger(value)), 0n));
}

export function safeMultiply(value: number, multiplier: number): number {
  return fromBigInt(BigInt(assertPaise(value)) * BigInt(assertPaise(multiplier)));
}

export function paiseToRupees(value: number): string {
  const integer = BigInt(assertPaise(value));
  return `${integer / 100n}.${(integer % 100n).toString().padStart(2, "0")}`;
}

export function formatINR(value: number): string {
  const [whole, fraction] = paiseToRupees(value).split(".");
  return `₹${new Intl.NumberFormat("en-IN").format(BigInt(whole))}.${fraction}`;
}
