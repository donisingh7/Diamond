import type { MarketSchedule } from "@/lib/dates/market-time";

export const platformDefaults = {
  key: "platform", currency: "INR", timezone: "Asia/Kolkata", minimumStakePaise: 100,
  payoutMultiplier: 90, mockDepositEnabled: true, mockOtpEnabled: true,
} as const;

type SeedMarket = MarketSchedule & { name: string; slug: string; code: string; enabled: boolean; displayOrder: number };
export const marketDefaults: readonly SeedMarket[] = [
  { name: "Shree Ganesh", slug: "shree-ganesh", code: "SG", closeTimeMinutes: 1000, closeDayOffset: 0 },
  { name: "Delhi Bazar", slug: "delhi-bazar", code: "DB", closeTimeMinutes: 900, closeDayOffset: 0 },
  { name: "Faridabad", slug: "faridabad", code: "FB", closeTimeMinutes: 1070, closeDayOffset: 0 },
  { name: "Ghaziabad", slug: "ghaziabad", code: "GZ", closeTimeMinutes: 1260, closeDayOffset: 0 },
  { name: "Gali", slug: "gali", code: "GL", closeTimeMinutes: 1390, closeDayOffset: 0 },
  { name: "Disawar", slug: "disawar", code: "DS", closeTimeMinutes: 180, closeDayOffset: 1 },
].map((market, index) => ({
  ...market, timezone: "Asia/Kolkata", openTimeMinutes: 420,
  editLockMinutesBeforeClose: 60, enabled: true, displayOrder: index + 1,
}));
