import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import {
  buildDestinationSummary,
  cancelWithdrawalSchema,
  createWithdrawalSchema,
  toPaymentDetails,
  withdrawalsListQuerySchema,
  type CreateWithdrawalRequest,
} from "@/modules/withdrawals/validators/withdrawal-input";
import {
  assertWithdrawalAmount,
  clampWithdrawalListLimit,
  decodeWithdrawalCursor,
  encodeWithdrawalCursor,
  toWithdrawalDTO,
  WITHDRAWAL_LIST_MAX_LIMIT,
  withdrawalApproveKey,
  withdrawalReleaseKey,
  withdrawalReserveKey,
} from "@/modules/withdrawals/services/withdrawal.service";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function bankReq(over: Record<string, unknown> = {}) {
  const { bank, ...rest } = over;
  return {
    method: "BANK",
    amountPaise: 50_000,
    clientRequestId: REQUEST_ID,
    bank: {
      accountHolderName: "Ravi Kumar",
      accountNumber: "123456789012",
      confirmAccountNumber: "123456789012",
      ifsc: "hdfc0001234",
      bankName: "HDFC Bank",
      ...(bank as Record<string, unknown> | undefined),
    },
    ...rest,
  };
}

function upiReq(over: Record<string, unknown> = {}) {
  const { upi, ...rest } = over;
  return {
    method: "UPI",
    amountPaise: 50_000,
    clientRequestId: REQUEST_ID,
    upi: { upiId: "ravikumar@okhdfcbank", ...(upi as Record<string, unknown> | undefined) },
    ...rest,
  };
}

// --- create-withdrawal validator ---------------------------------------------------------

describe("createWithdrawalSchema", () => {
  it("accepts a well-formed BANK request (with and without bankName) and upper-cases the IFSC", () => {
    const parsed = createWithdrawalSchema.parse(bankReq());
    if (parsed.method !== "BANK") throw new Error("unreachable");
    expect(parsed.bank.ifsc).toBe("HDFC0001234");
    expect(createWithdrawalSchema.safeParse(bankReq({ bank: { bankName: undefined } })).success).toBe(true);
  });

  it("accepts a well-formed UPI request and lower-cases the UPI id", () => {
    const parsed = createWithdrawalSchema.parse(upiReq({ upi: { upiId: "RaviKumar@OKHDFCBANK" } }));
    if (parsed.method !== "UPI") throw new Error("unreachable");
    expect(parsed.upi.upiId).toBe("ravikumar@okhdfcbank");
  });

  it("rejects a BANK request whose account-number confirmation does not match", () => {
    expect(createWithdrawalSchema.safeParse(bankReq({ bank: { confirmAccountNumber: "999999999999" } })).success).toBe(false);
  });

  it("rejects a malformed IFSC / account number / UPI id", () => {
    expect(createWithdrawalSchema.safeParse(bankReq({ bank: { ifsc: "HDFC123" } })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(bankReq({ bank: { accountNumber: "12A45", confirmAccountNumber: "12A45" } })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(bankReq({ bank: { accountNumber: "123", confirmAccountNumber: "123" } })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(upiReq({ upi: { upiId: "no-at-sign" } })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(upiReq({ upi: { upiId: "sp ace@okhdfc" } })).success).toBe(false);
  });

  it("rejects a missing / non-UUID clientRequestId and a non-positive / fractional amount", () => {
    expect(createWithdrawalSchema.safeParse(bankReq({ clientRequestId: undefined })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(bankReq({ clientRequestId: "not-a-uuid" })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(bankReq({ amountPaise: 0 })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(bankReq({ amountPaise: -100 })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(bankReq({ amountPaise: 100.5 })).success).toBe(false);
  });

  it("rejects client-supplied authoritative / cross-method / stray fields (.strict)", () => {
    expect(createWithdrawalSchema.safeParse(bankReq({ userId: "x" })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(bankReq({ status: "APPROVED" })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(bankReq({ destinationSummary: "spoof" })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(bankReq({ upi: { upiId: "a@b" } })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(upiReq({ bank: { accountNumber: "1" } })).success).toBe(false);
    expect(createWithdrawalSchema.safeParse(bankReq({ bank: { nickname: "main" } })).success).toBe(false);
  });
});

describe("toPaymentDetails", () => {
  it("BANK: drops the duplicated confirmation, keeps bankName only when present", () => {
    const details = toPaymentDetails(createWithdrawalSchema.parse(bankReq()) as CreateWithdrawalRequest);
    expect(details).toEqual({
      accountHolderName: "Ravi Kumar",
      accountNumber: "123456789012",
      ifsc: "HDFC0001234",
      bankName: "HDFC Bank",
    });
    expect(details).not.toHaveProperty("confirmAccountNumber");
    const noBank = toPaymentDetails(createWithdrawalSchema.parse(bankReq({ bank: { bankName: undefined } })) as CreateWithdrawalRequest);
    expect(noBank).not.toHaveProperty("bankName");
  });

  it("UPI: only the upiId", () => {
    expect(toPaymentDetails(createWithdrawalSchema.parse(upiReq()) as CreateWithdrawalRequest)).toEqual({
      upiId: "ravikumar@okhdfcbank",
    });
  });
});

describe("buildDestinationSummary", () => {
  it("BANK masks all but the last four account digits and prefixes the bank", () => {
    expect(buildDestinationSummary(createWithdrawalSchema.parse(bankReq()) as CreateWithdrawalRequest)).toBe("HDFC Bank ••••9012");
    expect(
      buildDestinationSummary(createWithdrawalSchema.parse(bankReq({ bank: { bankName: undefined } })) as CreateWithdrawalRequest),
    ).toBe("Bank ••••9012");
  });

  it("UPI keeps two handle characters and the PSP, masks the rest", () => {
    expect(buildDestinationSummary(createWithdrawalSchema.parse(upiReq()) as CreateWithdrawalRequest)).toBe("ra••@okhdfcbank");
    expect(
      buildDestinationSummary(createWithdrawalSchema.parse(upiReq({ upi: { upiId: "ab@ybl" } })) as CreateWithdrawalRequest),
    ).toBe("••@ybl");
  });
});

describe("withdrawalsListQuerySchema", () => {
  it("defaults limit to 20, coerces, and rejects out-of-range / stray params", () => {
    expect(withdrawalsListQuerySchema.parse({}).limit).toBe(20);
    expect(withdrawalsListQuerySchema.parse({ limit: "5" }).limit).toBe(5);
    expect(withdrawalsListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(withdrawalsListQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(withdrawalsListQuerySchema.safeParse({ status: "DONE" }).success).toBe(false);
    expect(withdrawalsListQuerySchema.safeParse({ nope: "1" }).success).toBe(false);
  });

  it("accepts each withdrawal status filter", () => {
    for (const status of ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const) {
      expect(withdrawalsListQuerySchema.parse({ status }).status).toBe(status);
    }
  });
});

describe("cancelWithdrawalSchema", () => {
  it("accepts an empty body and rejects any stray field", () => {
    expect(cancelWithdrawalSchema.safeParse({}).success).toBe(true);
    expect(cancelWithdrawalSchema.safeParse({ confirm: true }).success).toBe(false);
  });
});

// --- amount guard ----------------------------------------------------------------------

describe("assertWithdrawalAmount", () => {
  it("accepts exactly ₹1 (100 paise), rejects below it and non-safe integers", () => {
    expect(assertWithdrawalAmount(100)).toBe(100);
    const cases: [number, string][] = [
      [99, "INVALID_AMOUNT"],
      [100.5, "MONEY_OUT_OF_RANGE"],
      [Number.MAX_SAFE_INTEGER + 2, "MONEY_OUT_OF_RANGE"],
    ];
    for (const [amount, code] of cases) {
      try {
        assertWithdrawalAmount(amount);
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as { code?: string }).code).toBe(code);
      }
    }
  });
});

// --- ledger keys ---------------------------------------------------------------------

describe("withdrawal ledger keys", () => {
  it("are deterministic and encode the withdrawal id and transition", () => {
    const id = new Types.ObjectId("0123456789abcdef01234567");
    expect(withdrawalReserveKey(id)).toBe("WITHDRAWAL_RESERVED:0123456789abcdef01234567");
    expect(withdrawalReleaseKey(id)).toBe("WITHDRAWAL_RELEASED:0123456789abcdef01234567");
    expect(withdrawalApproveKey(id)).toBe("WITHDRAWAL_APPROVED:0123456789abcdef01234567");
    expect(withdrawalReserveKey(id)).toBe(withdrawalReserveKey(id));
  });
});

// --- cursor + limit ------------------------------------------------------------------

describe("withdrawal list cursor", () => {
  it("round-trips (createdAt, _id) and rejects a malformed token as INVALID_INPUT", () => {
    const at = new Date("2026-09-07T09:00:00.000Z");
    const id = new Types.ObjectId();
    expect(decodeWithdrawalCursor(encodeWithdrawalCursor(at, id))).toEqual({ t: at.getTime(), id: id.toHexString() });
    expect(() => decodeWithdrawalCursor("!!!not-base64!!!")).toThrow();
    try {
      decodeWithdrawalCursor("eyJ0IjoiYmFkIn0");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("INVALID_INPUT");
    }
  });
});

describe("clampWithdrawalListLimit", () => {
  it("undefined → 20, floors at 1, caps at the max, truncates", () => {
    expect(clampWithdrawalListLimit(undefined)).toBe(20);
    expect(clampWithdrawalListLimit(0)).toBe(1);
    expect(clampWithdrawalListLimit(-3)).toBe(1);
    expect(clampWithdrawalListLimit(999)).toBe(WITHDRAWAL_LIST_MAX_LIMIT);
    expect(clampWithdrawalListLimit(7.9)).toBe(7);
  });
});

// --- DTO ---------------------------------------------------------------------------

describe("toWithdrawalDTO", () => {
  const base = {
    _id: new Types.ObjectId(),
    method: "BANK" as const,
    amountPaise: 30_000,
    destinationSummary: "HDFC Bank ••••9012",
    rejectionReason: null,
    requestedAt: new Date("2026-09-07T08:00:00.000Z"),
    decidedAt: null as Date | null,
    createdAt: new Date("2026-09-07T08:00:00.000Z"),
    updatedAt: new Date("2026-09-07T08:00:00.000Z"),
  };

  it("PENDING: no decision timestamps, no reason", () => {
    const dto = toWithdrawalDTO({ ...base, status: "PENDING" });
    expect(dto).toMatchObject({
      id: base._id.toString(),
      method: "BANK",
      amountPaise: 30_000,
      status: "PENDING",
      destination: { method: "BANK", summary: "HDFC Bank ••••9012" },
      rejectionReason: null,
      decidedAt: null,
      cancelledAt: null,
      approvedAt: null,
      rejectedAt: null,
    });
  });

  it("CANCELLED / APPROVED / REJECTED map the generic decidedAt onto the status-specific field", () => {
    const decidedAt = new Date("2026-09-07T09:30:00.000Z");
    const cancelled = toWithdrawalDTO({ ...base, status: "CANCELLED", decidedAt });
    expect(cancelled.cancelledAt).toBe(decidedAt.toISOString());
    expect(cancelled.approvedAt).toBeNull();
    expect(cancelled.rejectedAt).toBeNull();
    expect(cancelled.decidedAt).toBe(decidedAt.toISOString());

    const approved = toWithdrawalDTO({ ...base, status: "APPROVED", decidedAt });
    expect(approved.approvedAt).toBe(decidedAt.toISOString());
    expect(approved.cancelledAt).toBeNull();

    const rejected = toWithdrawalDTO({ ...base, status: "REJECTED", decidedAt, rejectionReason: "KYC mismatch" });
    expect(rejected.rejectedAt).toBe(decidedAt.toISOString());
    expect(rejected.rejectionReason).toBe("KYC mismatch");
  });

  it("never serializes sensitive or internal fields", () => {
    const dto = toWithdrawalDTO({ ...base, status: "PENDING" }) as Record<string, unknown>;
    for (const key of ["userId", "paymentDetails", "clientRequestId", "decidedByAdminId", "destinationSummary", "__v"]) {
      expect(dto).not.toHaveProperty(key);
    }
    expect(Object.keys(dto).sort()).toEqual(
      [
        "amountPaise", "approvedAt", "cancelledAt", "createdAt", "decidedAt", "destination",
        "id", "method", "rejectedAt", "rejectionReason", "requestedAt", "status", "updatedAt",
      ],
    );
  });
});
