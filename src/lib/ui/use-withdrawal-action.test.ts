import { afterEach, describe, expect, it, vi } from "vitest";
import { submitWithdrawalAction, type WithdrawalAction } from "./use-withdrawal-action";
import { buildDestinationSummary, createWithdrawalSchema } from "@/modules/withdrawals/validators/withdrawal-input";

const request: WithdrawalAction = { kind: "request", request: { method: "UPI", amountPaise: 50000, clientRequestId: "0a7b3ea8-e47b-4d74-8bea-73c82cf6c100", upi: { upiId: "player@bank" } } };
afterEach(() => vi.unstubAllGlobals());

describe("player withdrawal submission", () => {
  it("replays the exact request after a lost response and uses returned wallet data", async () => {
    const receipt = { withdrawal: { status: "PENDING" }, wallet: { availableBalancePaise: 12345, reservedBalancePaise: 50000 } };
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Connection lost")).mockResolvedValueOnce(new Response(JSON.stringify({ data: receipt })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitWithdrawalAction(request)).rejects.toThrow("Connection lost");
    await expect(submitWithdrawalAction(request)).resolves.toEqual(receipt);
    const first = fetchMock.mock.calls[0][1] as RequestInit;
    const replay = fetchMock.mock.calls[1][1] as RequestInit;
    expect(first.body).toBe(replay.body);
    expect(JSON.parse(String(first.body))).toEqual(request.kind === "request" ? request.request : undefined);
    expect(first.method).toBe("POST");
    expect(first.credentials).toBe("same-origin");
  });
  it("cancels only the chosen withdrawal without submitting amounts or wallet changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { withdrawal: { status: "CANCELLED" }, wallet: {} } })));
    vi.stubGlobal("fetch", fetchMock);
    await submitWithdrawalAction({ kind: "cancel", id: "chosen-withdrawal" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/withdrawals/chosen-withdrawal/cancel");
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("body");
  });
  it.each([400, 401, 403, 409, 422])("surfaces explicit %i rejections", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Request rejected" } }), { status })));
    await expect(submitWithdrawalAction(request)).rejects.toMatchObject({ message: "Request rejected", uncertain: false });
  });
  it.each([200, 500, 503])("retains uncertainty without confirmation at %i", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    await expect(submitWithdrawalAction(request)).rejects.toMatchObject({ uncertain: true });
  });
  it("uses the existing bank validation and masking contract", () => {
    const bank = { method: "BANK", amountPaise: 10000, clientRequestId: "0a7b3ea8-e47b-4d74-8bea-73c82cf6c100", bank: { accountHolderName: "Test Player", accountNumber: "1234567890", confirmAccountNumber: "1234567891", ifsc: "ABCD0123456" } };
    const invalid = createWithdrawalSchema.safeParse(bank);
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.error.issues[0].path).toEqual(["bank", "confirmAccountNumber"]);
    const valid = createWithdrawalSchema.parse({ ...bank, bank: { ...bank.bank, confirmAccountNumber: bank.bank.accountNumber } });
    expect(buildDestinationSummary(valid)).toBe("Bank ••••7890");
  });
});
