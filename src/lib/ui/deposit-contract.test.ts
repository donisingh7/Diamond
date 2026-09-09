import { describe, expect, it } from "vitest";
import { approvalInput, createMethodInput, depositSubmission, maskedUtr, positiveAmount, rejectionInput, updateMethodInput } from "./deposit-contract";

const clientRequestId = "0a7b3ea8-e47b-4d74-8bea-73c82cf6c100";
const id = "1234567890abcdef12345678";
describe("deposit UI contracts", () => {
  it.each(["0", "-1", "1.005", "1e3", "9007199254740991"])("rejects an invalid rupee amount %s", value => {
    expect(() => positiveAmount(value)).toThrow();
  });
  it("requires uploaded proof and a valid UTR, without accepting a client credit", () => {
    const input = { paymentMethodId: id, requestedAmountPaise: 500000, proofImageId: id, utr: "UTR-123456", clientRequestId };
    expect(depositSubmission.parse(input)).toEqual(input);
    expect(depositSubmission.safeParse({ ...input, proofImageId: "" }).success).toBe(false);
    expect(depositSubmission.safeParse({ ...input, utr: "" }).success).toBe(false);
    expect(depositSubmission.safeParse({ ...input, approvedAmountPaise: 500000 }).success).toBe(false);
  });
  it.each(["4500", "5500"])("requires a remark for changed approval amount %s", approved => {
    expect(() => approvalInput(approved, 500000, "   ", clientRequestId)).toThrow("remark");
    expect(approvalInput(approved, 500000, " Verified transfer ", clientRequestId)).toEqual({ approvedAmountPaise: Number(approved) * 100, adminRemark: "Verified transfer", clientRequestId });
  });
  it("allows an equal approval amount without a remark; rejection requires one", () => {
    expect(approvalInput("5000", 500000, "", clientRequestId)).toEqual({ approvedAmountPaise: 500000, clientRequestId });
    expect(rejectionInput.safeParse({ adminRemark: "   ", clientRequestId }).success).toBe(false);
  });
  it("preserves masked bank details on an update and keeps method type immutable", () => {
    expect(updateMethodInput.parse({ displayName: "Bank payments", sortOrder: -1 })).not.toHaveProperty("accountNumber");
    expect(updateMethodInput.safeParse({ accountNumber: "••••1234" }).success).toBe(false);
    expect(updateMethodInput.safeParse({ type: "UPI" }).success).toBe(false);
    expect(createMethodInput.safeParse({ type: "BANK", displayName: "Bank payments" }).success).toBe(false);
  });
  it("does not expose the complete UTR in player history", () => {
    expect(maskedUtr("UTR-1234 5678")).toBe("••••5678");
  });
});
