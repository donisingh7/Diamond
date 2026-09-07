import { afterEach, describe, expect, it, vi } from "vitest";
import { submitBetEdit } from "./use-bet-edit";
import type { EditBetRequest } from "@/modules/betting/validators/edit-bet-input";

const request: EditBetRequest = { entryMethod: "COPY_PASTE", rawInput: "07 22", palti: true, stakePaise: 1000, expectedVersion: 2, editRequestId: "0a7b3ea8-e47b-4d74-8bea-73c82cf6c100" };
afterEach(() => vi.unstubAllGlobals());

describe("edit API boundary", () => {
  it("replays the same payload and returns the server revision without calculating wallet values", async () => {
    const bet = { publicRef: "DIA-TEST", version: 3, revisions: [{ walletDeltaPaise: -1000 }] };
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Connection lost")).mockResolvedValueOnce(new Response(JSON.stringify({ data: { bet } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitBetEdit("DIA-TEST", request)).rejects.toThrow("Connection lost");
    await expect(submitBetEdit("DIA-TEST", request)).resolves.toEqual(bet);
    const first = fetchMock.mock.calls[0][1] as RequestInit;
    const retry = fetchMock.mock.calls[1][1] as RequestInit;
    expect(first.body).toBe(retry.body);
    expect(JSON.parse(String(first.body))).toEqual(request);
    expect(first.method).toBe("PATCH");
    expect(first.credentials).toBe("same-origin");
  });
  it.each([400, 401, 403, 409, 422])("treats explicit %i rejection as a failed edit", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Server rejected edit" } }), { status })));
    await expect(submitBetEdit("DIA-TEST", request)).rejects.toMatchObject({ message: "Server rejected edit", uncertain: false });
  });
  it.each([200, 500, 503])("treats missing confirmation at %i as uncertain", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status })));
    await expect(submitBetEdit("DIA-TEST", request)).rejects.toMatchObject({ uncertain: true });
  });
});
