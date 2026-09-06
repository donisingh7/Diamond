import { describe, expect, it } from "vitest";
import {
  deriveMarketStatus,
  getBettingWindow,
  getRoundTimes,
  resolveMarketBusinessDate,
  type RoundState,
} from "@/lib/dates/market-time";
import { marketDefaults } from "@/modules/settings/seed-data";

const schedule = (slug: string) => marketDefaults.find((market) => market.slug === slug)!;
/** IST wall-clock → instant, matching the +05:30 literal style used across the suite. */
const ist = (value: string) => new Date(`${value}+05:30`);

function roundState(slug: string, businessDate: string, overrides: Partial<RoundState> = {}): RoundState {
  return { ...getRoundTimes(schedule(slug), businessDate), settlementStatus: "PENDING", ...overrides };
}

describe("getBettingWindow — same-day market (Faridabad, close 17:50, edit cutoff 16:50)", () => {
  const round = roundState("faridabad", "2026-09-06");
  const at = (value: string) => getBettingWindow(true, round, ist(value));

  it("06:59:59 → not open yet", () => {
    expect(at("2026-09-06T06:59:59")).toEqual({ canPlaceBet: false, canEditBet: false, reason: "MARKET_NOT_OPEN" });
    expect(deriveMarketStatus(true, round, ist("2026-09-06T06:59:59"))).toBe("UPCOMING");
  });
  it("07:00:00 → open, editable", () => {
    expect(at("2026-09-06T07:00:00")).toEqual({ canPlaceBet: true, canEditBet: true, reason: undefined });
    expect(deriveMarketStatus(true, round, ist("2026-09-06T07:00:00"))).toBe("OPEN");
  });
  it("16:49:59 → still editable", () => {
    expect(at("2026-09-06T16:49:59")).toMatchObject({ canPlaceBet: true, canEditBet: true });
  });
  it("16:50:00 → edit locked, new bets still allowed (CLOSING_SOON)", () => {
    expect(at("2026-09-06T16:50:00")).toEqual({ canPlaceBet: true, canEditBet: false, reason: "EDIT_WINDOW_CLOSED" });
    expect(deriveMarketStatus(true, round, ist("2026-09-06T16:50:00"))).toBe("CLOSING_SOON");
  });
  it("17:49:59 → bet allowed", () => {
    expect(at("2026-09-06T17:49:59")).toMatchObject({ canPlaceBet: true, canEditBet: false });
  });
  it("17:50:00 → closed for new bets, result pending", () => {
    expect(at("2026-09-06T17:50:00")).toEqual({ canPlaceBet: false, canEditBet: false, reason: "MARKET_CLOSED" });
    expect(deriveMarketStatus(true, round, ist("2026-09-06T17:50:00"))).toBe("RESULT_PENDING");
  });
});

describe("getBettingWindow — exact close boundaries for the other same-day markets", () => {
  it("Delhi Bazar closes exactly at 15:00", () => {
    const round = roundState("delhi-bazar", "2026-09-06");
    expect(getBettingWindow(true, round, ist("2026-09-06T14:59:59")).canPlaceBet).toBe(true);
    expect(getBettingWindow(true, round, ist("2026-09-06T15:00:00")).canPlaceBet).toBe(false);
  });
  it("Gali closes exactly at 23:10", () => {
    const round = roundState("gali", "2026-09-06");
    expect(getBettingWindow(true, round, ist("2026-09-06T23:09:59")).canPlaceBet).toBe(true);
    expect(getBettingWindow(true, round, ist("2026-09-06T23:10:00")).canPlaceBet).toBe(false);
  });
  it("Shree Ganesh closes exactly at 16:40, Ghaziabad at 21:00", () => {
    const sg = roundState("shree-ganesh", "2026-09-06");
    expect(getBettingWindow(true, sg, ist("2026-09-06T16:39:59")).canPlaceBet).toBe(true);
    expect(getBettingWindow(true, sg, ist("2026-09-06T16:40:00")).canPlaceBet).toBe(false);
    const gz = roundState("ghaziabad", "2026-09-06");
    expect(getBettingWindow(true, gz, ist("2026-09-06T20:59:59")).canPlaceBet).toBe(true);
    expect(getBettingWindow(true, gz, ist("2026-09-06T21:00:00")).canPlaceBet).toBe(false);
  });
});

describe("getBettingWindow / deriveMarketStatus — Disawar cross-midnight (Sep 6 business round)", () => {
  const round = roundState("disawar", "2026-09-06"); // opens Sep 6 07:00, edit cutoff Sep 7 02:00, closes Sep 7 03:00
  const window = (value: string) => getBettingWindow(true, round, ist(value));
  const status = (value: string) => deriveMarketStatus(true, round, ist(value));

  it("snapshots close and edit cutoff onto the next calendar day", () => {
    expect(round.closesAt.toISOString()).toBe("2026-09-06T21:30:00.000Z"); // 2026-09-07 03:00 IST
    expect(round.editCutoffAt.toISOString()).toBe("2026-09-06T20:30:00.000Z"); // 2026-09-07 02:00 IST
  });
  it("Sep 6 06:59 → upcoming", () => expect(status("2026-09-06T06:59:00")).toBe("UPCOMING"));
  it("Sep 6 07:00 → open", () => {
    expect(window("2026-09-06T07:00:00")).toMatchObject({ canPlaceBet: true, canEditBet: true });
    expect(status("2026-09-06T07:00:00")).toBe("OPEN");
  });
  it("Sep 6 23:59 → open", () => expect(status("2026-09-06T23:59:00")).toBe("OPEN"));
  it("Sep 7 00:00 → open", () => {
    expect(window("2026-09-07T00:00:00")).toMatchObject({ canPlaceBet: true, canEditBet: true });
    expect(status("2026-09-07T00:00:00")).toBe("OPEN");
  });
  it("Sep 7 01:59 → still editable", () => {
    expect(window("2026-09-07T01:59:00")).toMatchObject({ canPlaceBet: true, canEditBet: true });
  });
  it("Sep 7 02:00 → edit locked, bets still allowed", () => {
    expect(window("2026-09-07T02:00:00")).toEqual({ canPlaceBet: true, canEditBet: false, reason: "EDIT_WINDOW_CLOSED" });
    expect(status("2026-09-07T02:00:00")).toBe("CLOSING_SOON");
  });
  it("Sep 7 02:59:59 → bet allowed", () => {
    expect(window("2026-09-07T02:59:59")).toMatchObject({ canPlaceBet: true, canEditBet: false });
  });
  it("Sep 7 03:00 → the Sep 6 round is closed / result pending", () => {
    expect(window("2026-09-07T03:00:00")).toEqual({ canPlaceBet: false, canEditBet: false, reason: "MARKET_CLOSED" });
    expect(status("2026-09-07T03:00:00")).toBe("RESULT_PENDING");
  });
});

describe("resolveMarketBusinessDate — Disawar current-round convention across the gap", () => {
  const disawar = schedule("disawar");
  it("before close stays on the opening business date", () => {
    expect(resolveMarketBusinessDate(disawar, ist("2026-09-07T02:59:59"))).toBe("2026-09-06");
  });
  it("at and after 03:00 flips to the new calendar business date (previous round now closed)", () => {
    expect(resolveMarketBusinessDate(disawar, ist("2026-09-07T03:00:00"))).toBe("2026-09-07");
    expect(resolveMarketBusinessDate(disawar, ist("2026-09-07T03:01:00"))).toBe("2026-09-07");
    expect(resolveMarketBusinessDate(disawar, ist("2026-09-07T06:59:00"))).toBe("2026-09-07");
    expect(resolveMarketBusinessDate(disawar, ist("2026-09-07T07:00:00"))).toBe("2026-09-07");
  });
});

describe("getBettingWindow — non-time gates", () => {
  const round = roundState("faridabad", "2026-09-06");
  const openInstant = round.opensAt;
  it("disabled market never allows betting and needs no round", () => {
    expect(getBettingWindow(false, null, openInstant)).toEqual({ canPlaceBet: false, canEditBet: false, reason: "MARKET_DISABLED" });
    expect(getBettingWindow(false, round, openInstant)).toEqual({ canPlaceBet: false, canEditBet: false, reason: "MARKET_DISABLED" });
  });
  it("enabled market with no round reports ROUND_NOT_FOUND", () => {
    expect(getBettingWindow(true, null, openInstant)).toEqual({ canPlaceBet: false, canEditBet: false, reason: "ROUND_NOT_FOUND" });
  });
  it("a declared result or non-pending settlement closes the window even mid-hours", () => {
    expect(getBettingWindow(true, { ...round, result: "07" }, openInstant)).toMatchObject({ canPlaceBet: false, reason: "MARKET_CLOSED" });
    expect(getBettingWindow(true, { ...round, settlementStatus: "SETTLED" }, openInstant)).toMatchObject({ canPlaceBet: false, reason: "MARKET_CLOSED" });
  });
});
