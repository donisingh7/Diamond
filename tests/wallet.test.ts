import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/errors/domain-error";
import { walletTransactionTypes } from "@/modules/wallet/models/wallet-transaction.model";
import {
  assertMovementAmount,
  isDuplicateKeyError,
  movementDeltas,
  toWalletView,
} from "@/modules/wallet/services/wallet.service";
import {
  assertMockDepositAmount,
  buildMockDepositKey,
  MOCK_DEPOSIT_MINIMUM_PAISE,
} from "@/modules/wallet/services/mock-deposit.service";
import {
  clampWalletTransactionsLimit,
  decodeWalletCursor,
  encodeWalletCursor,
  toWalletTransactionDTO,
  WALLET_TRANSACTIONS_DEFAULT_LIMIT,
  WALLET_TRANSACTIONS_MAX_LIMIT,
} from "@/modules/wallet/services/wallet-transactions.service";
import {
  mockDepositSchema,
  walletTransactionsQuerySchema,
} from "@/modules/wallet/validators/wallet-input";

/** Return the value thrown by `fn` (for asserting `DomainError.code`), or `undefined`. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("movementDeltas — frozen type → balance movement table", () => {
  const A = 500;
  it.each([
    ["MOCK_DEPOSIT", { availableDeltaPaise: A, reservedDeltaPaise: 0 }],
    ["BET_EDIT_REFUND", { availableDeltaPaise: A, reservedDeltaPaise: 0 }],
    ["WIN_CREDIT", { availableDeltaPaise: A, reservedDeltaPaise: 0 }],
    ["ADMIN_CREDIT", { availableDeltaPaise: A, reservedDeltaPaise: 0 }],
    ["BET_PLACED", { availableDeltaPaise: -A, reservedDeltaPaise: 0 }],
    ["BET_EDIT_DEBIT", { availableDeltaPaise: -A, reservedDeltaPaise: 0 }],
    ["ADMIN_DEBIT", { availableDeltaPaise: -A, reservedDeltaPaise: 0 }],
    ["WITHDRAWAL_RESERVED", { availableDeltaPaise: -A, reservedDeltaPaise: A }],
    ["WITHDRAWAL_RELEASED", { availableDeltaPaise: A, reservedDeltaPaise: -A }],
    ["WITHDRAWAL_APPROVED", { availableDeltaPaise: 0, reservedDeltaPaise: -A }],
  ] as const)("%s", (type, expected) => {
    expect(movementDeltas(type, A)).toEqual(expected);
  });

  it("covers every canonical ledger type exactly once", () => {
    for (const type of walletTransactionTypes) {
      expect(() => movementDeltas(type, 100)).not.toThrow();
    }
  });

  it("every movement conserves value between available and reserved", () => {
    for (const type of walletTransactionTypes) {
      const { availableDeltaPaise, reservedDeltaPaise } = movementDeltas(type, 100);
      // deposits/credits add 100, debits subtract 100, reserve/release/finalize net across the two buckets.
      const net = availableDeltaPaise + reservedDeltaPaise;
      expect([100, -100, 0]).toContain(net);
    }
  });
});

describe("assertMovementAmount", () => {
  it("accepts a positive whole number of paise", () => {
    expect(assertMovementAmount(1)).toBe(1);
    expect(assertMovementAmount(999_999)).toBe(999_999);
  });
  it("rejects zero, negative and fractional amounts as INVALID_AMOUNT / MONEY_OUT_OF_RANGE", () => {
    expect(() => assertMovementAmount(0)).toThrow(DomainError);
    expect(() => assertMovementAmount(0)).toThrowError(/at least 1 paise/);
    expect(() => assertMovementAmount(-5)).toThrow(DomainError);
    expect(() => assertMovementAmount(1.5)).toThrow(/precision/);
  });
  it("rejects an unsafe integer", () => {
    expect(() => assertMovementAmount(Number.MAX_SAFE_INTEGER + 1)).toThrowError(/precision/);
  });
});

describe("mock deposit amount rules", () => {
  it("minimum is ₹1 (100 paise), no product maximum", () => {
    expect(MOCK_DEPOSIT_MINIMUM_PAISE).toBe(100);
    expect(assertMockDepositAmount(100)).toBe(100);
    expect(assertMockDepositAmount(1_00_00_00_000)).toBe(1_00_00_00_000); // ₹10,00,000 — accepted, no cap
  });
  it("rejects 99 paise, fractional, negative and unsafe integers", () => {
    expect(thrownBy(() => assertMockDepositAmount(99))).toMatchObject({ code: "INVALID_AMOUNT" });
    expect(thrownBy(() => assertMockDepositAmount(150.5))).toMatchObject({ code: "MONEY_OUT_OF_RANGE" });
    expect(() => assertMockDepositAmount(-100)).toThrow(DomainError);
    expect(thrownBy(() => assertMockDepositAmount(Number.MAX_SAFE_INTEGER + 2))).toMatchObject({ code: "MONEY_OUT_OF_RANGE" });
  });
});

describe("buildMockDepositKey", () => {
  it("is deterministic from user + operation + clientRequestId (not the amount)", () => {
    const userId = new Types.ObjectId("64b7f9a2c1e4a2b3d4e5f6a7");
    const key = buildMockDepositKey(userId, "11111111-1111-4111-8111-111111111111");
    expect(key).toBe("MOCK_DEPOSIT:64b7f9a2c1e4a2b3d4e5f6a7:11111111-1111-4111-8111-111111111111");
    expect(buildMockDepositKey(userId, "11111111-1111-4111-8111-111111111111")).toBe(key);
    expect(buildMockDepositKey(userId, "22222222-2222-4222-8222-222222222222")).not.toBe(key);
  });
});

describe("toWalletView", () => {
  it("derives total = available + reserved", () => {
    expect(toWalletView({ currency: "INR", availableBalancePaise: 10_000, reservedBalancePaise: 2_000 })).toEqual({
      currency: "INR",
      availableBalancePaise: 10_000,
      reservedBalancePaise: 2_000,
      totalBalancePaise: 12_000,
    });
  });
});

describe("toWalletTransactionDTO", () => {
  const row = {
    _id: new Types.ObjectId(),
    type: "MOCK_DEPOSIT",
    amountPaise: 10_000,
    availableDeltaPaise: 10_000,
    reservedDeltaPaise: 0,
    availableBeforePaise: 0,
    availableAfterPaise: 10_000,
    reservedBeforePaise: 0,
    reservedAfterPaise: 0,
    referenceType: "MOCK_DEPOSIT",
    createdAt: new Date("2026-09-06T10:00:00.000Z"),
  };

  it("exposes exactly the player-safe fields and no internal metadata", () => {
    const dto = toWalletTransactionDTO(row);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "amountPaise",
        "availableAfterPaise",
        "availableBeforePaise",
        "availableDeltaPaise",
        "createdAt",
        "id",
        "referenceType",
        "reservedAfterPaise",
        "reservedBeforePaise",
        "reservedDeltaPaise",
        "type",
      ].sort(),
    );
    expect(dto).not.toHaveProperty("idempotencyKey");
    expect(dto).not.toHaveProperty("createdByAdminId");
    expect(dto).not.toHaveProperty("walletId");
    expect(dto).not.toHaveProperty("userId");
    expect(dto.id).toBe(row._id.toString());
    expect(dto.createdAt).toBe("2026-09-06T10:00:00.000Z");
  });
  it("null referenceType when absent", () => {
    expect(toWalletTransactionDTO({ ...row, referenceType: undefined }).referenceType).toBeNull();
  });
});

describe("wallet transactions pagination bounds", () => {
  it("clamps limit into [1, 100] with a default of 20", () => {
    expect(clampWalletTransactionsLimit(undefined)).toBe(WALLET_TRANSACTIONS_DEFAULT_LIMIT);
    expect(WALLET_TRANSACTIONS_DEFAULT_LIMIT).toBe(20);
    expect(WALLET_TRANSACTIONS_MAX_LIMIT).toBe(100);
    expect(clampWalletTransactionsLimit(0)).toBe(1);
    expect(clampWalletTransactionsLimit(1)).toBe(1);
    expect(clampWalletTransactionsLimit(50)).toBe(50);
    expect(clampWalletTransactionsLimit(101)).toBe(100);
    expect(clampWalletTransactionsLimit(10_000)).toBe(100);
  });

  it("round-trips an opaque cursor and rejects a malformed one", () => {
    const id = new Types.ObjectId();
    const at = new Date("2026-09-06T10:00:00.000Z");
    const cursor = encodeWalletCursor(at, id);
    expect(cursor).toMatch(/^[\w-]+$/); // base64url, no padding chars
    expect(decodeWalletCursor(cursor)).toEqual({ t: at.getTime(), id: id.toHexString() });
    for (const bad of ["", "!!!!", "not-base64", Buffer.from('{"t":"x"}').toString("base64url")]) {
      expect(thrownBy(() => decodeWalletCursor(bad))).toMatchObject({ code: "INVALID_INPUT" });
    }
  });
});

describe("isDuplicateKeyError", () => {
  it("recognizes an E11000 in code, cause.code or message", () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(isDuplicateKeyError({ cause: { code: 11000 } })).toBe(true);
    expect(isDuplicateKeyError(new Error("E11000 duplicate key error"))).toBe(true);
    expect(isDuplicateKeyError({ code: 121 })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError("nope")).toBe(false);
  });
});

describe("mockDepositSchema", () => {
  const valid = { amountPaise: 10_000, clientRequestId: "11111111-1111-4111-8111-111111111111" };
  it("accepts a positive integer amount and a UUID client request id", () => {
    expect(mockDepositSchema.parse(valid)).toEqual(valid);
  });
  it("rejects fractional, zero, negative amounts, a non-UUID id and unknown keys", () => {
    expect(mockDepositSchema.safeParse({ ...valid, amountPaise: 100.5 }).success).toBe(false);
    expect(mockDepositSchema.safeParse({ ...valid, amountPaise: 0 }).success).toBe(false);
    expect(mockDepositSchema.safeParse({ ...valid, amountPaise: -1 }).success).toBe(false);
    expect(mockDepositSchema.safeParse({ ...valid, clientRequestId: "not-a-uuid" }).success).toBe(false);
    expect(mockDepositSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe("walletTransactionsQuerySchema", () => {
  it("defaults limit to 20 and coerces a string limit", () => {
    expect(walletTransactionsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(walletTransactionsQuerySchema.parse({ limit: "50" })).toEqual({ limit: 50 });
  });
  it("rejects limit above 100, below 1, and stray params", () => {
    expect(walletTransactionsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(walletTransactionsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(walletTransactionsQuerySchema.safeParse({ foo: "bar" }).success).toBe(false);
  });
  it("passes an opaque cursor through untouched", () => {
    expect(walletTransactionsQuerySchema.parse({ cursor: "abc", limit: "5" })).toEqual({ limit: 5, cursor: "abc" });
  });
});
