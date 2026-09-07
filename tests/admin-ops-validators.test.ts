import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/errors/domain-error";
import {
  adminAuditListQuerySchema,
  adminBetsListQuerySchema,
  adminWithdrawalsListQuerySchema,
  approveWithdrawalSchema,
  declareResultSchema,
  prepareResultSchema,
  rejectWithdrawalSchema,
  resultStringSchema,
  setMarketStatusSchema,
  updateMarketScheduleSchema,
  updatePayoutRateSchema,
} from "@/modules/admin/validators/admin-ops-input";
import { clampLimit, decodeCursor, encodeCursor, olderThan } from "@/modules/admin/services/pagination";
import { toAdminAuditLogDTO } from "@/modules/admin/services/admin-audit.service";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("approveWithdrawalSchema — Mark Paid & Approve", () => {
  it("requires the literal confirmPaid: true", () => {
    expect(approveWithdrawalSchema.safeParse({ clientRequestId: uuid }).success).toBe(false);
    expect(approveWithdrawalSchema.safeParse({ confirmPaid: false, clientRequestId: uuid }).success).toBe(false);
    expect(approveWithdrawalSchema.safeParse({ confirmPaid: "true", clientRequestId: uuid }).success).toBe(false);
  });

  it("accepts confirmPaid: true + a uuid, and trims optional metadata", () => {
    const parsed = approveWithdrawalSchema.parse({
      confirmPaid: true,
      clientRequestId: uuid,
      paymentReference: "  UTR-9931  ",
      note: "  paid by NEFT  ",
    });
    expect(parsed).toMatchObject({ confirmPaid: true, paymentReference: "UTR-9931", note: "paid by NEFT" });
  });

  it("rejects a non-uuid clientRequestId and any stray field", () => {
    expect(approveWithdrawalSchema.safeParse({ confirmPaid: true, clientRequestId: "not-a-uuid" }).success).toBe(false);
    expect(
      approveWithdrawalSchema.safeParse({ confirmPaid: true, clientRequestId: uuid, status: "APPROVED" }).success,
    ).toBe(false);
  });
});

describe("rejectWithdrawalSchema", () => {
  it("requires a non-empty bounded reason + uuid", () => {
    expect(rejectWithdrawalSchema.safeParse({ clientRequestId: uuid }).success).toBe(false);
    expect(rejectWithdrawalSchema.safeParse({ reason: "   ", clientRequestId: uuid }).success).toBe(false);
    expect(rejectWithdrawalSchema.safeParse({ reason: "x".repeat(501), clientRequestId: uuid }).success).toBe(false);
    expect(rejectWithdrawalSchema.parse({ reason: "  bad details  ", clientRequestId: uuid }).reason).toBe("bad details");
  });

  it("rejects a stray field", () => {
    expect(
      rejectWithdrawalSchema.safeParse({ reason: "no", clientRequestId: uuid, refund: true }).success,
    ).toBe(false);
  });
});

describe("result string — two-character, leading zero preserved", () => {
  it.each(["00", "07", "70", "99"])("accepts %s", (value) => {
    expect(resultStringSchema.parse(value)).toBe(value);
  });

  it.each(["0", "7", "100", "1", "ab", "7a", "-1", "1.5", ""])("rejects %s", (value) => {
    expect(resultStringSchema.safeParse(value).success).toBe(false);
  });

  it("never numerically coerces (stays a string)", () => {
    expect(typeof resultStringSchema.parse("08")).toBe("string");
  });
});

describe("prepareResultSchema / declareResultSchema", () => {
  const marketId = new Types.ObjectId().toHexString();

  it("prepare: marketId hex + result required, businessDate optional, strict", () => {
    expect(prepareResultSchema.parse({ marketId, result: "07" })).toMatchObject({ marketId, result: "07" });
    expect(prepareResultSchema.parse({ marketId, businessDate: "2026-09-07", result: "07" }).businessDate).toBe(
      "2026-09-07",
    );
    expect(prepareResultSchema.safeParse({ marketId: "xyz", result: "07" }).success).toBe(false);
    expect(prepareResultSchema.safeParse({ marketId, result: "07", confirm: true }).success).toBe(false);
    expect(prepareResultSchema.safeParse({ marketId, result: "07", businessDate: "07-09-2026" }).success).toBe(false);
  });

  it("declare: requires the literal confirm: true + a uuid", () => {
    expect(declareResultSchema.safeParse({ marketId, result: "07", clientRequestId: uuid }).success).toBe(false);
    expect(
      declareResultSchema.safeParse({ marketId, result: "07", confirm: false, clientRequestId: uuid }).success,
    ).toBe(false);
    expect(
      declareResultSchema.safeParse({ marketId, result: "07", confirm: true, clientRequestId: "nope" }).success,
    ).toBe(false);
    expect(
      declareResultSchema.parse({ marketId, result: "07", confirm: true, clientRequestId: uuid }),
    ).toMatchObject({ marketId, result: "07", confirm: true });
  });
});

describe("updateMarketScheduleSchema", () => {
  it("accepts HH:MM times and rejects malformed ones", () => {
    expect(updateMarketScheduleSchema.parse({ openTime: "07:00", closeTime: "16:40" })).toMatchObject({
      openTime: "07:00",
      closeTime: "16:40",
    });
    for (const bad of ["7:00", "24:00", "12:60", "0700", "07:0"]) {
      expect(updateMarketScheduleSchema.safeParse({ openTime: bad }).success).toBe(false);
    }
  });

  it("closeDayOffset is 0|1 only; editLock is a bounded non-negative int", () => {
    expect(updateMarketScheduleSchema.parse({ closeDayOffset: 1 }).closeDayOffset).toBe(1);
    expect(updateMarketScheduleSchema.safeParse({ closeDayOffset: 2 }).success).toBe(false);
    expect(updateMarketScheduleSchema.safeParse({ editLockMinutesBeforeClose: -1 }).success).toBe(false);
    expect(updateMarketScheduleSchema.safeParse({ editLockMinutesBeforeClose: 1.5 }).success).toBe(false);
  });

  it("requires at least one field and rejects stray fields", () => {
    expect(updateMarketScheduleSchema.safeParse({}).success).toBe(false);
    expect(updateMarketScheduleSchema.safeParse({ openTimeMinutes: 420 }).success).toBe(false);
  });
});

describe("setMarketStatusSchema / updatePayoutRateSchema", () => {
  it("status is a strict boolean", () => {
    expect(setMarketStatusSchema.parse({ enabled: false }).enabled).toBe(false);
    expect(setMarketStatusSchema.safeParse({ enabled: "false" }).success).toBe(false);
    expect(setMarketStatusSchema.safeParse({ enabled: true, force: 1 }).success).toBe(false);
  });

  it("payout multiplier is a positive integer within a sane bound", () => {
    expect(updatePayoutRateSchema.parse({ payoutMultiplier: 95 }).payoutMultiplier).toBe(95);
    for (const bad of [0, -5, 1.5, 1001]) {
      expect(updatePayoutRateSchema.safeParse({ payoutMultiplier: bad }).success).toBe(false);
    }
    expect(updatePayoutRateSchema.safeParse({ payoutMultiplier: 95, currency: "INR" }).success).toBe(false);
  });
});

describe("admin list query schemas", () => {
  it("withdrawals list: default limit 25, [1,100], enum filters, strict", () => {
    expect(adminWithdrawalsListQuerySchema.parse({}).limit).toBe(25);
    expect(adminWithdrawalsListQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(adminWithdrawalsListQuerySchema.safeParse({ limit: "200" }).success).toBe(false);
    expect(adminWithdrawalsListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(adminWithdrawalsListQuerySchema.safeParse({ status: "PAID" }).success).toBe(false);
    expect(adminWithdrawalsListQuerySchema.safeParse({ method: "CARD" }).success).toBe(false);
    expect(adminWithdrawalsListQuerySchema.safeParse({ nonsense: 1 }).success).toBe(false);
    expect(adminWithdrawalsListQuerySchema.safeParse({ dateFrom: "not-a-date" }).success).toBe(false);
  });

  it("audit list: default limit 25, hex id filters, strict", () => {
    expect(adminAuditListQuerySchema.parse({}).limit).toBe(25);
    expect(adminAuditListQuerySchema.safeParse({ actorAdminId: "short" }).success).toBe(false);
    expect(adminAuditListQuerySchema.parse({ action: "RESULT_DECLARED" }).action).toBe("RESULT_DECLARED");
    expect(adminAuditListQuerySchema.safeParse({ page: 2 }).success).toBe(false);
  });

  it("bets list: default limit 20, [1,50], enum + businessDate, strict", () => {
    expect(adminBetsListQuerySchema.parse({}).limit).toBe(20);
    expect(adminBetsListQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(adminBetsListQuerySchema.safeParse({ limit: "999" }).success).toBe(false);
    expect(adminBetsListQuerySchema.safeParse({ entryMethod: "PARLAY" }).success).toBe(false);
    expect(adminBetsListQuerySchema.safeParse({ businessDate: "2026/09/07" }).success).toBe(false);
    expect(adminBetsListQuerySchema.safeParse({ status: "ACTIVE", foo: 1 }).success).toBe(false);
  });
});

describe("shared keyset cursor", () => {
  it("round-trips (at, id) and rejects a malformed cursor with INVALID_INPUT", () => {
    const at = new Date("2026-09-07T10:00:00.000Z");
    const id = new Types.ObjectId();
    const decoded = decodeCursor(encodeCursor(at, id));
    expect(decoded).toEqual({ t: at.getTime(), id: id.toHexString() });
    expect(() => decodeCursor("!!!not-base64!!!")).toThrow(DomainError);
    try {
      decodeCursor(Buffer.from(JSON.stringify({ t: "x", id: "y" })).toString("base64url"));
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as DomainError).code).toBe("INVALID_INPUT");
    }
  });

  it("olderThan builds a strict (field, _id) descending keyset clause", () => {
    const at = new Date("2026-09-07T10:00:00.000Z");
    const id = new Types.ObjectId();
    const clause = olderThan("requestedAt", { t: at.getTime(), id: id.toHexString() });
    expect(clause[0]).toEqual({ requestedAt: { $lt: at } });
    expect(clause[1].requestedAt).toEqual(at);
  });

  it("clampLimit applies the fallback and the [1, max] bound", () => {
    expect(clampLimit(undefined, 25, 100)).toBe(25);
    expect(clampLimit(0, 25, 100)).toBe(1);
    expect(clampLimit(500, 25, 100)).toBe(100);
    expect(clampLimit(30, 25, 100)).toBe(30);
  });
});

describe("toAdminAuditLogDTO — read-path redaction", () => {
  it("re-redacts secret-bearing keys in before/after and normalizes a Map snapshot", () => {
    const dto = toAdminAuditLogDTO({
      _id: new Types.ObjectId(),
      action: "RESULT_DECLARED",
      entityType: "MarketRound",
      entityId: new Types.ObjectId(),
      actorAdminId: new Types.ObjectId(),
      subjectUserId: null,
      before: null,
      after: new Map<string, unknown>([
        ["result", "07"],
        ["password", "hunter2"],
        ["sessionSecret", "abcdef"],
        ["nested", { token: "zzz", keep: 1 }],
      ]),
      createdAt: new Date(),
    });
    expect(dto.after).toMatchObject({ result: "07", password: "[REDACTED]", sessionSecret: "[REDACTED]" });
    expect((dto.after!.nested as Record<string, unknown>)).toEqual({ token: "[REDACTED]", keep: 1 });
    expect(dto.before).toBeNull();
    expect(dto.subjectUserId).toBeNull();
  });
});
