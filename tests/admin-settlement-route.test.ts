import { afterEach, describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";
import { NextRequest } from "next/server";
import { DomainError } from "@/lib/errors/domain-error";
import { requireAdmin } from "@/lib/auth/session";
import { settleDeclaredRound } from "@/modules/admin/services/admin-settlement.service";
import { POST } from "@/app/api/admin/results/settle/route";

/**
 * Route-level contract for `POST /api/admin/results/settle` (Window 7A2). The settlement engine
 * and its idempotency guarantees are covered by the 7A1 tests + `admin-settlement.integration`;
 * here we pin only what the HTTP boundary owns: same-origin/CSRF, ADMIN gating, strict body
 * validation (no `result` smuggling), and that the service summary is relayed unchanged.
 */

vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/modules/admin/services/admin-settlement.service", () => ({ settleDeclaredRound: vi.fn() }));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockSettle = vi.mocked(settleDeclaredRound);

const uuid = "11111111-1111-4111-8111-111111111111";
const marketId = new Types.ObjectId().toHexString();

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost:3000/api/admin/results/settle", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/results/settle", () => {
  it("rejects a cross-origin request before touching auth or the service (403 FORBIDDEN)", async () => {
    const res = await post(
      { marketId, confirm: true, clientRequestId: uuid },
      { origin: "https://evil.example.com" },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
    expect(mockRequireAdmin).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("returns 401 for an anonymous caller and never settles", async () => {
    mockRequireAdmin.mockRejectedValueOnce(new DomainError("UNAUTHENTICATED", "Sign in required."));
    const res = await post({ marketId, confirm: true, clientRequestId: uuid });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-ADMIN (PLAYER) caller and never settles", async () => {
    mockRequireAdmin.mockRejectedValueOnce(new DomainError("FORBIDDEN", "Admin access required."));
    const res = await post({ marketId, confirm: true, clientRequestId: uuid });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("rejects a body carrying a `result` field (400) — settlement cannot modify the result", async () => {
    mockRequireAdmin.mockResolvedValueOnce({ _id: new Types.ObjectId() } as Awaited<ReturnType<typeof requireAdmin>>);
    const res = await post({ marketId, result: "07", confirm: true, clientRequestId: uuid });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("invokes settleDeclaredRound with the admin id + market and relays its summary", async () => {
    const adminId = new Types.ObjectId();
    const summary = {
      roundId: new Types.ObjectId().toString(),
      market: { id: marketId, name: "Faridabad", slug: "faridabad", code: "FRB" },
      result: "07",
      settlementStatus: "SETTLED",
      alreadySettled: false,
      auditWritten: true,
      wonCount: 1,
      lostCount: 2,
    };
    mockRequireAdmin.mockResolvedValueOnce({ _id: adminId } as Awaited<ReturnType<typeof requireAdmin>>);
    mockSettle.mockResolvedValueOnce(summary as Awaited<ReturnType<typeof settleDeclaredRound>>);

    const res = await post({ marketId, businessDate: "2026-09-06", confirm: true, clientRequestId: uuid });
    expect(res.status).toBe(200);
    expect((await res.json()).data.settlement).toEqual(summary);
    expect(mockSettle).toHaveBeenCalledWith({
      actorAdminId: adminId,
      marketId,
      businessDate: "2026-09-06",
    });
  });

  it("relays an already-settled replay summary unchanged (200, auditWritten: false)", async () => {
    mockRequireAdmin.mockResolvedValueOnce({ _id: new Types.ObjectId() } as Awaited<ReturnType<typeof requireAdmin>>);
    mockSettle.mockResolvedValueOnce({
      settlementStatus: "SETTLED",
      alreadySettled: true,
      auditWritten: false,
      wonCount: 1,
      lostCount: 2,
    } as Awaited<ReturnType<typeof settleDeclaredRound>>);
    const res = await post({ marketId, confirm: true, clientRequestId: uuid });
    expect(res.status).toBe(200);
    const body = (await res.json()).data.settlement;
    expect(body).toMatchObject({ alreadySettled: true, auditWritten: false, settlementStatus: "SETTLED" });
  });
});
