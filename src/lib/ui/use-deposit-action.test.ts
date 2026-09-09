import { afterEach, describe, expect, it, vi } from "vitest";
import { depositRequest } from "./use-deposit-action";

afterEach(() => vi.unstubAllGlobals());
describe("deposit API boundary", () => {
  it("resends the same deposit identity and proof after a lost response", async () => {
    const request = { paymentMethodId: "1234567890abcdef12345678", requestedAmountPaise: 500000, proofImageId: "abcdef123456789012345678", utr: "UTR123456", clientRequestId: "0a7b3ea8-e47b-4d74-8bea-73c82cf6c100" };
    const body = JSON.stringify(request);
    const data = { deposit: { id: "server-deposit", status: "PENDING", requestedAmountPaise: 500000, approvedAmountPaise: null } };
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Connection lost")).mockResolvedValueOnce(new Response(JSON.stringify({ data })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(depositRequest("/api/deposits", body)).rejects.toThrow();
    await expect(depositRequest("/api/deposits", body)).resolves.toEqual(data);
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(request);
    expect(fetchMock.mock.calls[1][1].credentials).toBe("same-origin");
  });
  it.each(["/api/deposits/proof", "/api/admin/payment-methods/qr"])("uploads a multipart file to %s without overriding its boundary", async url => {
    const body = new FormData(); body.set("file", new File(["test image"], "proof.png", { type: "image/png" }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { proofImageId: "server-image" } })));
    vi.stubGlobal("fetch", fetchMock);
    await depositRequest(url, body);
    expect(fetchMock.mock.calls[0][0]).toBe(url);
    expect(fetchMock.mock.calls[0][1].body).toBe(body);
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("headers");
  });
  it.each([400, 409, 422])("surfaces a definite %i rejection", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "UTR already used" } }), { status })));
    await expect(depositRequest("/api/deposits", "{}")).rejects.toMatchObject({ message: "UTR already used", uncertain: false });
  });
  it.each([200, 500, 503])("does not confirm an ambiguous %i response", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    await expect(depositRequest("/api/deposits", "{}")).rejects.toMatchObject({ uncertain: true });
  });
});
