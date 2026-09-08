import { describe, expect, it } from "vitest";
import { businessDateLabel, countdownTarget, marketDateTime, marketStates, marketTime } from "@/lib/ui/market-presentation";
import type { MarketDTO } from "@/modules/markets/services/market-dto";

const market: MarketDTO = {
  id: "market", name: "Disawar", slug: "disawar", code: "DS", timezone: "Asia/Kolkata", enabled: true,
  editLockMinutesBeforeClose: 60, displayOrder: 1, state: "OPEN",
  round: { id: "round", businessDate: "2026-09-06", opensAt: "2026-09-06T01:30:00.000Z", editCutoffAt: "2026-09-06T20:30:00.000Z", closesAt: "2026-09-06T21:30:00.000Z", state: "OPEN", result: null, resultDeclaredAt: null, settlementStatus: "PENDING", canPlaceBet: true, canEditBet: true, unavailableReason: null },
};

describe("player timing presentation", () => {
  it("displays the persisted next-day close in IST, independently of browser timezone", () => {
    expect(marketDateTime(market.round!.closesAt, market.timezone)).toMatch(/7 Sept? 2026,? 03:00 am/i);
    expect(marketTime(market.round!.opensAt, market.timezone)).toMatch(/07:00 am/i);
    expect(businessDateLabel(market.round!.businessDate)).toMatch(/6 Sept? 2026/);
  });
  it("uses closing time, not editing cutoff, throughout the server's closing-soon interval", () => {
    const closing = { ...market, state: "CLOSING_SOON" as const, round: { ...market.round!, canEditBet: false } };
    expect(countdownTarget(closing)).toEqual({ target: market.round!.closesAt, label: "Closes in" });
  });
  it("never infers placement availability from the client clock or an OPEN label", () => {
    expect(countdownTarget({ ...market, round: { ...market.round!, canPlaceBet: false } })).toBeNull();
    expect(countdownTarget({ ...market, state: "DISABLED", round: null })).toBeNull();
  });
  it("counts toward the persisted opening instant of an upcoming round", () => {
    expect(countdownTarget({ ...market, state: "UPCOMING" })).toEqual({ target: market.round!.opensAt, label: "Opens in" });
  });
  it("provides textual labels for every server lifecycle state", () => {
    expect(Object.keys(marketStates)).toHaveLength(7);
    expect(marketStates.RESULT_PENDING.label).toBe("Result pending");
    expect(marketStates.CLOSING_SOON.label).toBe("Closing soon");
  });
});
