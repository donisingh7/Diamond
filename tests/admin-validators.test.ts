import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPlayerSchema,
  listPlayersQuerySchema,
  setPlayerStatusSchema,
  resetPlayerPasswordSchema,
  adminWalletAdjustmentSchema,
  adminWalletTransactionsQuerySchema,
  adminPlayerBetsQuerySchema,
} from "@/modules/admin/validators/admin-player-input";
import {
  auditActions,
  redactAuditSnapshot,
} from "@/modules/audit/services/audit-log.service";
import {
  ADMIN_WALLET_MINIMUM_PAISE,
  assertAdminAdjustmentAmount,
  buildAdminAdjustmentKey,
  toAdminWalletTransactionDTO,
} from "@/modules/admin/services/admin-wallet.service";
import { Types } from "mongoose";

describe("createPlayerSchema", () => {
  const base = { loginId: "Player_One", name: "Player One", password: "s3cret-demo" };

  it("accepts a minimal body and normalizes loginId", () => {
    const parsed = createPlayerSchema.parse(base);
    expect(parsed.loginId).toBe("player_one");
    expect(parsed.name).toBe("Player One");
  });

  it("accepts an optional phone and email, lower-casing the email", () => {
    const parsed = createPlayerSchema.parse({ ...base, phone: " 9998887777 ", email: "P1@Example.COM" });
    expect(parsed.phone).toBe("9998887777");
    expect(parsed.email).toBe("p1@example.com");
  });

  it("rejects a client-supplied role (strict), an empty name, a missing password and a stray field", () => {
    expect(() => createPlayerSchema.parse({ ...base, role: "ADMIN" })).toThrow();
    expect(() => createPlayerSchema.parse({ ...base, name: "   " })).toThrow();
    expect(() => createPlayerSchema.parse({ loginId: "x", name: "x" })).toThrow();
    expect(() => createPlayerSchema.parse({ ...base, status: "ACTIVE" })).toThrow();
    expect(() => createPlayerSchema.parse({ ...base, passwordHash: "abc" })).toThrow();
  });
});

describe("listPlayersQuerySchema", () => {
  it("defaults limit to 25 and clamps to the 1..100 range", () => {
    expect(listPlayersQuerySchema.parse({}).limit).toBe(25);
    expect(listPlayersQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(() => listPlayersQuerySchema.parse({ limit: "0" })).toThrow();
    expect(() => listPlayersQuerySchema.parse({ limit: "101" })).toThrow();
  });

  it("accepts each status and rejects an unknown status or a stray param", () => {
    expect(listPlayersQuerySchema.parse({ status: "ACTIVE" }).status).toBe("ACTIVE");
    expect(listPlayersQuerySchema.parse({ status: "DISABLED" }).status).toBe("DISABLED");
    expect(() => listPlayersQuerySchema.parse({ status: "PENDING" })).toThrow();
    expect(() => listPlayersQuerySchema.parse({ role: "PLAYER" })).toThrow();
  });
});

describe("setPlayerStatusSchema / resetPlayerPasswordSchema", () => {
  it("status accepts only ACTIVE or DISABLED", () => {
    expect(setPlayerStatusSchema.parse({ status: "ACTIVE" }).status).toBe("ACTIVE");
    expect(() => setPlayerStatusSchema.parse({ status: "GONE" })).toThrow();
    expect(() => setPlayerStatusSchema.parse({ status: "ACTIVE", extra: 1 })).toThrow();
  });

  it("reset requires a non-empty newPassword and rejects a stray field", () => {
    expect(resetPlayerPasswordSchema.parse({ newPassword: "abc" }).newPassword).toBe("abc");
    expect(() => resetPlayerPasswordSchema.parse({ newPassword: "" })).toThrow();
    expect(() => resetPlayerPasswordSchema.parse({ newPassword: "abc", loginId: "x" })).toThrow();
  });
});

describe("adminWalletAdjustmentSchema", () => {
  const base = { amountPaise: 500000, reason: "Manual UPI payment received", clientRequestId: randomUUID() };

  it("accepts a valid credit/debit body with an optional paymentReference", () => {
    expect(adminWalletAdjustmentSchema.parse(base).paymentReference).toBeUndefined();
    expect(adminWalletAdjustmentSchema.parse({ ...base, paymentReference: "UTR123456" }).paymentReference).toBe("UTR123456");
  });

  it("trims the reason and rejects an empty one", () => {
    expect(adminWalletAdjustmentSchema.parse({ ...base, reason: "  ok  " }).reason).toBe("ok");
    expect(() => adminWalletAdjustmentSchema.parse({ ...base, reason: "   " })).toThrow();
  });

  it("rejects a non-positive / fractional amount, a non-uuid request id, a resulting balance and stray fields", () => {
    expect(() => adminWalletAdjustmentSchema.parse({ ...base, amountPaise: 0 })).toThrow();
    expect(() => adminWalletAdjustmentSchema.parse({ ...base, amountPaise: -100 })).toThrow();
    expect(() => adminWalletAdjustmentSchema.parse({ ...base, amountPaise: 100.5 })).toThrow();
    expect(() => adminWalletAdjustmentSchema.parse({ ...base, clientRequestId: "not-a-uuid" })).toThrow();
    expect(() => adminWalletAdjustmentSchema.parse({ ...base, availableBalancePaise: 999 })).toThrow();
    expect(() => adminWalletAdjustmentSchema.parse({ ...base, balance: 999 })).toThrow();
  });
});

describe("admin query schemas", () => {
  it("adminWalletTransactionsQuerySchema defaults 20 and caps at 100", () => {
    expect(adminWalletTransactionsQuerySchema.parse({}).limit).toBe(20);
    expect(() => adminWalletTransactionsQuerySchema.parse({ limit: "101" })).toThrow();
  });

  it("adminPlayerBetsQuerySchema accepts status + market and rejects a stray param", () => {
    const parsed = adminPlayerBetsQuerySchema.parse({ status: "WON", market: "faridabad" });
    expect(parsed).toMatchObject({ status: "WON", market: "faridabad", limit: 20 });
    expect(() => adminPlayerBetsQuerySchema.parse({ foo: "bar" })).toThrow();
  });
});

describe("buildAdminAdjustmentKey", () => {
  it("is deterministic and operation-agnostic (same key for credit and debit)", () => {
    const admin = new Types.ObjectId();
    const rid = randomUUID();
    const a = buildAdminAdjustmentKey(admin, rid);
    const b = buildAdminAdjustmentKey(admin, rid);
    expect(a).toBe(b);
    expect(a).toContain(admin.toHexString());
    expect(a).toContain(rid);
    // a different admin or request id changes the key
    expect(buildAdminAdjustmentKey(new Types.ObjectId(), rid)).not.toBe(a);
    expect(buildAdminAdjustmentKey(admin, randomUUID())).not.toBe(a);
  });
});

describe("assertAdminAdjustmentAmount", () => {
  it("accepts the ₹1 minimum and rejects below it or outside safe-integer precision", () => {
    expect(assertAdminAdjustmentAmount(ADMIN_WALLET_MINIMUM_PAISE)).toBe(100);
    expect(() => assertAdminAdjustmentAmount(99)).toThrow(/INVALID_AMOUNT|Minimum/);
    expect(() => assertAdminAdjustmentAmount(100.5)).toThrow();
    expect(() => assertAdminAdjustmentAmount(Number.MAX_SAFE_INTEGER + 3)).toThrow();
  });
});

describe("toAdminWalletTransactionDTO", () => {
  it("exposes reason / paymentReference / actorAdminId but never the idempotency key", () => {
    const adminId = new Types.ObjectId();
    const dto = toAdminWalletTransactionDTO({
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      walletId: new Types.ObjectId(),
      type: "ADMIN_CREDIT",
      amountPaise: 5000,
      availableDeltaPaise: 5000,
      reservedDeltaPaise: 0,
      availableBeforePaise: 0,
      availableAfterPaise: 5000,
      reservedBeforePaise: 0,
      reservedAfterPaise: 0,
      referenceType: "ADMIN_ADJUSTMENT",
      idempotencyKey: "ADMIN_WALLET_ADJUSTMENT:secret:key",
      adminReason: "Manual UPI payment received",
      adminPaymentReference: "UTR123456",
      createdByAdminId: adminId,
      createdAt: new Date("2026-09-07T00:00:00.000Z"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(dto).toMatchObject({
      type: "ADMIN_CREDIT",
      amountPaise: 5000,
      reason: "Manual UPI payment received",
      paymentReference: "UTR123456",
      actorAdminId: adminId.toString(),
      referenceType: "ADMIN_ADJUSTMENT",
    });
    expect(dto).not.toHaveProperty("idempotencyKey");
    expect(dto).not.toHaveProperty("adminReason");
    expect(dto).not.toHaveProperty("userId");
    expect(dto).not.toHaveProperty("walletId");
  });
});

describe("audit-log service", () => {
  it("declares exactly the Window 6A1 actions", () => {
    expect([...auditActions]).toEqual([
      "PLAYER_CREATED",
      "PLAYER_DISABLED",
      "PLAYER_ENABLED",
      "PLAYER_PASSWORD_RESET",
      "PLAYER_DELETION_COMPLETED",
      "ADMIN_WALLET_CREDIT",
      "ADMIN_WALLET_DEBIT",
    ]);
  });

  it("redacts secret-bearing keys at any depth and leaves the rest intact", () => {
    const redacted = redactAuditSnapshot({
      loginId: "player_one",
      password: "hunter2",
      passwordHash: "scrypt-v1$...",
      nested: { newPassword: "x", token: "y", keep: 1 },
      list: [{ sessionToken: "z", ok: true }],
      amountPaise: 5000,
    }) as Record<string, unknown>;
    expect(redacted.loginId).toBe("player_one");
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.passwordHash).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).newPassword).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).token).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).keep).toBe(1);
    expect(((redacted.list as Record<string, unknown>[])[0]).sessionToken).toBe("[REDACTED]");
    expect(((redacted.list as Record<string, unknown>[])[0]).ok).toBe(true);
    expect(redacted.amountPaise).toBe(5000);
  });
});
