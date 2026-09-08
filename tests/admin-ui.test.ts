import { afterEach, describe, expect, it, vi } from "vitest";
import { adminRequest } from "@/lib/ui/use-admin-api";

afterEach(() => vi.unstubAllGlobals());
describe("admin operation transport", () => {
  it("does not silently repeat a financial operation after losing its response", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Connection lost"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(adminRequest("/api/admin/players/player/wallet/credit", "POST", JSON.stringify({ amountPaise: 10000, reason: "Verified deposit", clientRequestId: "request" }))).rejects.toThrow("Connection lost");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps an explicit replay's frozen payload and returns server money unchanged", async () => {
    const receipt = { wallet: { availableBalancePaise: 12345, reservedBalancePaise: 6789 }, idempotentReplay: true };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: receipt }))));
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({ amountPaise: 10000, clientRequestId: "same-request", reason: "Verified deposit" });
    await adminRequest("/api/admin/players/player/wallet/credit", "POST", body);
    await expect(adminRequest("/api/admin/players/player/wallet/credit", "POST", body)).resolves.toEqual(receipt);
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
    expect(fetchMock.mock.calls[1][1].credentials).toBe("same-origin");
  });
  it.each([400, 403, 409, 422])("preserves definite %i rejections", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "REJECTED", message: "Not allowed" } }), { status })));
    await expect(adminRequest("/api/admin/results/settle", "POST", "{}")).rejects.toMatchObject({ uncertain: false, code: "REJECTED", message: "Not allowed" });
  });
  it.each([200, 500, 503])("keeps missing confirmation at %i uncertain", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    await expect(adminRequest("/api/admin/withdrawals/id/approve", "POST", "{}")).rejects.toMatchObject({ uncertain: true });
  });
  it("retains the unauthenticated code for the admin login redirect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Sign in" } }), { status: 401 })));
    await expect(adminRequest("/api/admin/dashboard")).rejects.toMatchObject({ code: "UNAUTHENTICATED", uncertain: false });
  });
});
