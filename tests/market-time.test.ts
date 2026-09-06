import { describe, expect, it } from "vitest";
import { deriveMarketStatus, getRoundTimes, isBetEditAllowed, isBetPlacementAllowed, resolveMarketBusinessDate, type RoundState } from "@/lib/dates/market-time";
import { marketDefaults, platformDefaults } from "@/modules/settings/seed-data";

const faridabad = marketDefaults.find((s) => s.slug === "faridabad")!;
const disawar = marketDefaults.find((s) => s.slug === "disawar")!;
const round: RoundState = { ...getRoundTimes(faridabad, "2026-09-06"), settlementStatus: "PENDING" };

describe("market timing and seeds", () => {
  it("seeds exactly the six frozen schedules", () => {
    expect(marketDefaults.map((m) => [m.name, m.closeTimeMinutes, m.closeDayOffset])).toEqual([
      ["Shree Ganesh", 1000, 0], ["Delhi Bazar", 900, 0], ["Faridabad", 1070, 0],
      ["Ghaziabad", 1260, 0], ["Gali", 1390, 0], ["Disawar", 180, 1],
    ]);
    expect(new Set(marketDefaults.map((m) => m.slug)).size).toBe(6);
    expect(new Set(marketDefaults.map((m) => m.code)).size).toBe(6);
    for (const market of marketDefaults) {
      expect(market.openTimeMinutes).toBe(420);
      expect(market.timezone).toBe("Asia/Kolkata");
      expect(market.editLockMinutesBeforeClose).toBe(60);
    }
    expect(platformDefaults).toMatchObject({ currency: "INR", minimumStakePaise: 100, payoutMultiplier: 90, mockOtpEnabled: true, mockDepositEnabled: true });
  });
  it("constructs Faridabad instants from local time", () => {
    expect(round.opensAt.toISOString()).toBe("2026-09-06T01:30:00.000Z");
    expect(round.editCutoffAt.toISOString()).toBe("2026-09-06T11:20:00.000Z");
    expect(round.closesAt.toISOString()).toBe("2026-09-06T12:20:00.000Z");
  });
  it("places at open, edits before cutoff, places after cutoff, blocks at close", () => {
    expect(isBetPlacementAllowed(true, round, new Date(+round.opensAt - 1))).toBe(false);
    expect(isBetPlacementAllowed(true, round, round.opensAt)).toBe(true);
    expect(isBetEditAllowed(true, round, new Date(+round.editCutoffAt - 1), "ACTIVE")).toBe(true);
    expect(isBetEditAllowed(true, round, round.editCutoffAt, "ACTIVE")).toBe(false);
    expect(isBetPlacementAllowed(true, round, round.editCutoffAt)).toBe(true);
    expect(isBetPlacementAllowed(true, round, new Date(+round.closesAt - 1))).toBe(true);
    expect(isBetPlacementAllowed(true, round, round.closesAt)).toBe(false);
  });
  it("blocks disabled, resulted and settled rounds and settled bets", () => {
    expect(isBetPlacementAllowed(false, round, round.opensAt)).toBe(false);
    expect(isBetPlacementAllowed(true, { ...round, result: "00" }, round.opensAt)).toBe(false);
    expect(isBetPlacementAllowed(true, { ...round, settlementStatus: "PROCESSING" }, round.opensAt)).toBe(false);
    expect(isBetEditAllowed(true, round, round.opensAt, "WON")).toBe(false);
  });
  it("derives statuses without mutable OPEN state", () => {
    expect(deriveMarketStatus(false, round, round.opensAt)).toBe("DISABLED");
    expect(deriveMarketStatus(true, round, new Date(+round.opensAt - 1))).toBe("UPCOMING");
    expect(deriveMarketStatus(true, round, round.opensAt)).toBe("OPEN");
    expect(deriveMarketStatus(true, round, round.editCutoffAt)).toBe("CLOSING_SOON");
    expect(deriveMarketStatus(true, round, round.closesAt)).toBe("RESULT_PENDING");
    expect(deriveMarketStatus(true, { ...round, result: "00" }, round.closesAt)).toBe("RESULT_DECLARED");
    expect(deriveMarketStatus(true, { ...round, result: "00", settlementStatus: "SETTLED" }, round.closesAt)).toBe("SETTLED");
  });
  it("keeps Disawar on its opening business date after midnight", () => {
    const times = getRoundTimes(disawar, "2026-09-06");
    expect(times.closesAt.toISOString()).toBe("2026-09-06T21:30:00.000Z");
    expect(times.editCutoffAt.toISOString()).toBe("2026-09-06T20:30:00.000Z");
    expect(resolveMarketBusinessDate(disawar, new Date("2026-09-07T00:30:00+05:30"))).toBe("2026-09-06");
    expect(resolveMarketBusinessDate(disawar, new Date(+times.closesAt - 1))).toBe("2026-09-06");
    expect(resolveMarketBusinessDate(disawar, times.closesAt)).toBe("2026-09-07");
    expect(resolveMarketBusinessDate(disawar, new Date("2026-09-07T07:00:00+05:30"))).toBe("2026-09-07");
  });
  it.each([["2027-01-01T01:00:00+05:30", "2026-12-31"], ["2028-03-01T01:00:00+05:30", "2028-02-29"]])("handles calendar rollover at %s", (instant, expected) => {
    expect(resolveMarketBusinessDate(disawar, new Date(instant))).toBe(expected);
  });
  it("rejects invalid dates and schedules", () => {
    expect(() => getRoundTimes(disawar, "2026-02-30")).toThrow();
    expect(() => getRoundTimes({ ...faridabad, closeTimeMinutes: 1 }, "2026-09-06")).toThrow();
  });
});
