import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import {
  approveDepositSchema,
  createPaymentMethodSchema,
  maskAccountNumber,
  normalizeUtr,
  rejectDepositSchema,
  submitDepositSchema,
  updatePaymentMethodSchema,
} from "@/modules/payments/validators/payment-input";
import { PaymentMethod } from "@/modules/payments/models/payment-method.model";
import { DepositRequest } from "@/modules/payments/models/deposit-request.model";
import {
  toAdminDepositRequestDTO,
  toPlayerDepositRequestDTO,
} from "@/modules/payments/services/deposit-request.service";
import type { DepositRequestRow } from "@/modules/payments/models/deposit-request.model";
import { walletTransactionTypes } from "@/modules/wallet/models/wallet-transaction.model";
import { auditActions } from "@/modules/audit/services/audit-log.service";

const uuid = "11111111-1111-4111-8111-111111111111";
const hex = () => new Types.ObjectId().toHexString();

describe("Window 10A registrations", () => {
  it("adds DEPOSIT_CREDIT as a ledger type and the four deposit/payment audit actions", () => {
    expect(walletTransactionTypes).toContain("DEPOSIT_CREDIT");
    expect(auditActions).toEqual(
      expect.arrayContaining(["PAYMENT_METHOD_CREATED", "PAYMENT_METHOD_UPDATED", "DEPOSIT_APPROVED", "DEPOSIT_REJECTED"]),
    );
  });
});

describe("normalizeUtr / maskAccountNumber", () => {
  it("upper-cases and strips every separator", () => {
    expect(normalizeUtr("  abc-123 def  ")).toBe("ABC123DEF");
    expect(normalizeUtr("utr-2026-00 77")).toBe("UTR20260077");
    expect(normalizeUtr("AXIS12345")).toBe(normalizeUtr("axis 1 2 3 4 5"));
  });
  it("masks all but the last four digits", () => {
    expect(maskAccountNumber("123456789012")).toBe("••••9012");
    expect(maskAccountNumber("00 11 22 33")).toBe("••••2233");
  });
});

describe("createPaymentMethodSchema", () => {
  it("accepts a UPI method and rejects bank fields on it", () => {
    expect(createPaymentMethodSchema.parse({ type: "UPI", displayName: "Main UPI", upiId: "shop@okhdfc" })).toMatchObject({
      type: "UPI",
      upiId: "shop@okhdfc",
    });
    expect(
      createPaymentMethodSchema.safeParse({ type: "UPI", displayName: "Main UPI", upiId: "shop@okhdfc", ifsc: "HDFC0001234" }).success,
    ).toBe(false);
  });
  it("requires every bank field and rejects a stray key", () => {
    const bank = { type: "BANK", displayName: "Current A/C", accountHolderName: "Diamond", bankName: "HDFC", accountNumber: "1234567890", ifsc: "hdfc0001234" };
    expect(createPaymentMethodSchema.parse(bank)).toMatchObject({ ifsc: "HDFC0001234" });
    expect(createPaymentMethodSchema.safeParse({ ...bank, accountNumber: undefined }).success).toBe(false);
    expect(createPaymentMethodSchema.safeParse({ ...bank, isAdmin: true }).success).toBe(false);
  });
});

describe("updatePaymentMethodSchema", () => {
  it("needs at least one field and is strict", () => {
    expect(updatePaymentMethodSchema.safeParse({}).success).toBe(false);
    expect(updatePaymentMethodSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updatePaymentMethodSchema.safeParse({ type: "BANK" }).success).toBe(false);
  });
});

describe("submitDepositSchema", () => {
  const ok = { paymentMethodId: hex(), requestedAmountPaise: 500000, utr: "AXIS-9931-2211", proofImageId: hex(), clientRequestId: uuid };
  it("accepts a well-formed submission", () => {
    expect(submitDepositSchema.parse(ok)).toMatchObject({ requestedAmountPaise: 500000 });
  });
  it("rejects a non-positive amount, a bad id, a bad UTR and any stray field", () => {
    expect(submitDepositSchema.safeParse({ ...ok, requestedAmountPaise: 0 }).success).toBe(false);
    expect(submitDepositSchema.safeParse({ ...ok, requestedAmountPaise: 1.5 }).success).toBe(false);
    expect(submitDepositSchema.safeParse({ ...ok, paymentMethodId: "xyz" }).success).toBe(false);
    expect(submitDepositSchema.safeParse({ ...ok, utr: "no" }).success).toBe(false);
    expect(submitDepositSchema.safeParse({ ...ok, utr: "bad*chars" }).success).toBe(false);
    expect(submitDepositSchema.safeParse({ ...ok, approvedAmountPaise: 1 }).success).toBe(false);
  });
});

describe("approveDepositSchema / rejectDepositSchema", () => {
  it("approve: positive amount + optional remark, strict", () => {
    expect(approveDepositSchema.parse({ approvedAmountPaise: 450000, clientRequestId: uuid })).toMatchObject({ approvedAmountPaise: 450000 });
    expect(approveDepositSchema.safeParse({ approvedAmountPaise: -1, clientRequestId: uuid }).success).toBe(false);
    expect(approveDepositSchema.safeParse({ approvedAmountPaise: 1, clientRequestId: uuid, status: "APPROVED" }).success).toBe(false);
  });
  it("reject: non-empty remark required", () => {
    expect(rejectDepositSchema.safeParse({ clientRequestId: uuid }).success).toBe(false);
    expect(rejectDepositSchema.safeParse({ adminRemark: "   ", clientRequestId: uuid }).success).toBe(false);
    expect(rejectDepositSchema.parse({ adminRemark: "  proof unreadable  ", clientRequestId: uuid }).adminRemark).toBe("proof unreadable");
  });
});

describe("PaymentMethod schema invariants", () => {
  it("a UPI method requires upiId and no bank columns", async () => {
    await expect(new PaymentMethod({ type: "UPI", displayName: "X" }).validate()).rejects.toThrow();
    await expect(
      new PaymentMethod({ type: "UPI", displayName: "X", upiId: "x@y", accountNumber: "123456" }).validate(),
    ).rejects.toThrow();
    await new PaymentMethod({ type: "UPI", displayName: "X", upiId: "x@y" }).validate();
  });
  it("a BANK method requires all four bank fields", async () => {
    await expect(new PaymentMethod({ type: "BANK", displayName: "X", accountNumber: "123456" }).validate()).rejects.toThrow();
    await new PaymentMethod({
      type: "BANK", displayName: "X", accountHolderName: "A", bankName: "B", accountNumber: "123456", ifsc: "HDFC0001234",
    }).validate();
  });
});

describe("DepositRequest schema invariants", () => {
  const base = () => ({
    userId: new Types.ObjectId(),
    clientRequestId: "c-1",
    requestedAmountPaise: 500000,
    paymentMethodId: new Types.ObjectId(),
    paymentMethodSnapshot: { paymentMethodId: new Types.ObjectId(), type: "UPI", displayName: "Main" },
    utr: "AXIS99312211",
    normalizedUtr: "AXIS99312211",
    proofImageId: new Types.ObjectId(),
    submittedAt: new Date(),
  });
  it("PENDING carries no review fields", async () => {
    await new DepositRequest(base()).validate();
    await expect(new DepositRequest({ ...base(), approvedAmountPaise: 1 }).validate()).rejects.toThrow();
  });
  it("APPROVED needs a positive approved amount, a reviewer and a timestamp", async () => {
    await expect(new DepositRequest({ ...base(), status: "APPROVED" }).validate()).rejects.toThrow();
    await new DepositRequest({
      ...base(), status: "APPROVED", approvedAmountPaise: 500000, reviewedByAdminId: new Types.ObjectId(), reviewedAt: new Date(),
    }).validate();
  });
  it("APPROVED at a different amount requires an admin remark", async () => {
    const common = { ...base(), status: "APPROVED" as const, reviewedByAdminId: new Types.ObjectId(), reviewedAt: new Date() };
    await expect(new DepositRequest({ ...common, approvedAmountPaise: 450000 }).validate()).rejects.toThrow();
    await new DepositRequest({ ...common, approvedAmountPaise: 450000, adminRemark: "Short by ₹500 per bank statement" }).validate();
    await new DepositRequest({ ...common, approvedAmountPaise: 600000, adminRemark: "Extra ₹1000 received; credited in full" }).validate();
  });
  it("REJECTED requires a remark and credits nothing", async () => {
    const common = { ...base(), status: "REJECTED" as const, reviewedByAdminId: new Types.ObjectId(), reviewedAt: new Date() };
    await expect(new DepositRequest(common).validate()).rejects.toThrow();
    await expect(new DepositRequest({ ...common, adminRemark: "x", approvedAmountPaise: 1 }).validate()).rejects.toThrow();
    await new DepositRequest({ ...common, adminRemark: "Proof screenshot did not match the UTR" }).validate();
  });
});

describe("deposit DTOs never leak internal fields", () => {
  const row = {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    status: "APPROVED",
    requestedAmountPaise: 500000,
    approvedAmountPaise: 450000,
    paymentMethodId: new Types.ObjectId(),
    paymentMethodSnapshot: { type: "BANK", displayName: "Current", accountNumberMasked: "••••9012", ifsc: "HDFC0001234" },
    utr: "AXIS-9931",
    normalizedUtr: "AXIS9931",
    proofImageId: new Types.ObjectId(),
    adminRemark: "Short by ₹500",
    reviewedByAdminId: new Types.ObjectId(),
    submittedAt: new Date("2026-09-09T00:00:00.000Z"),
    reviewedAt: new Date("2026-09-09T01:00:00.000Z"),
    createdAt: new Date("2026-09-09T00:00:00.000Z"),
    updatedAt: new Date("2026-09-09T01:00:00.000Z"),
  } as unknown as DepositRequestRow;

  it("player DTO hides userId / normalizedUtr / reviewer and masks the account number", () => {
    const dto = toPlayerDepositRequestDTO(row);
    expect(dto).not.toHaveProperty("userId");
    expect(dto).not.toHaveProperty("normalizedUtr");
    expect(dto).not.toHaveProperty("reviewedByAdminId");
    expect(dto.paymentMethodSnapshot).not.toHaveProperty("accountNumber");
    expect(dto.paymentMethodSnapshot.accountNumberMasked).toBe("••••9012");
    expect(dto).toMatchObject({ requestedAmountPaise: 500000, approvedAmountPaise: 450000, status: "APPROVED" });
  });
  it("admin DTO adds userId + reviewer but still no normalizedUtr", () => {
    const dto = toAdminDepositRequestDTO(row);
    expect(dto.userId).toBe(row.userId.toString());
    expect(dto.reviewedByAdminId).toBe(row.reviewedByAdminId!.toString());
    expect(dto).not.toHaveProperty("normalizedUtr");
  });
});
