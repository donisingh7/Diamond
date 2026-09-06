import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { resolve } from "node:path";
import { DateTime } from "luxon";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "@/lib/db/connection";
import { ensureIndexes } from "@/lib/db/models";
import { seedFoundation } from "@/modules/settings/services/seed-foundation";
import { Market } from "@/modules/markets/models/market.model";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import { getRoundTimes } from "@/lib/dates/market-time";
import {
  ensureMarketRound,
  getMarketBySlug,
  listMarkets,
  marketScheduleOf,
  resolveCurrentRound,
  resolveCurrentRoundsForMarkets,
} from "@/modules/markets/services/market.service";
import { getCurrentResults, getResultHistory, historyWindow } from "@/modules/markets/services/result.service";

let replica: MongoMemoryReplSet | undefined;
const ist = (value: string) => new Date(`${value}+05:30`);

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_markets"));
  await connectDatabase();
  await ensureIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await Promise.all([Market.deleteMany({}), MarketRound.deleteMany({})]);
  await seedFoundation();
});

const marketBySlug = async (slug: string) => (await Market.findOne({ slug }))!;

async function makeResultRound(slug: string, businessDate: string, result: string): Promise<void> {
  const market = await marketBySlug(slug);
  const times = getRoundTimes(marketScheduleOf(market), businessDate);
  await MarketRound.create({
    marketId: market._id,
    businessDate,
    opensAt: times.opensAt,
    editCutoffAt: times.editCutoffAt,
    closesAt: times.closesAt,
    result,
    resultDeclaredAt: new Date(times.closesAt.getTime() + 60_000),
    declaredByAdminId: new Types.ObjectId(),
    settlementStatus: "PENDING",
  });
}

describe("ensureMarketRound", () => {
  it("snapshots opensAt/editCutoffAt/closesAt from the market's current schedule", async () => {
    const fb = await marketBySlug("faridabad");
    const round = await ensureMarketRound(fb, "2026-09-06");
    const expected = getRoundTimes(marketScheduleOf(fb), "2026-09-06");
    expect(round.opensAt.toISOString()).toBe(expected.opensAt.toISOString());
    expect(round.editCutoffAt.toISOString()).toBe(expected.editCutoffAt.toISOString());
    expect(round.closesAt.toISOString()).toBe(expected.closesAt.toISOString());
    expect(round.settlementStatus).toBe("PENDING");
    expect(round.result == null).toBe(true);
  });

  it("is idempotent — a rerun returns the same document", async () => {
    const fb = await marketBySlug("faridabad");
    const first = await ensureMarketRound(fb, "2026-09-06");
    const second = await ensureMarketRound(fb, "2026-09-06");
    expect(second._id.toString()).toBe(first._id.toString());
    expect(await MarketRound.countDocuments({ marketId: fb._id })).toBe(1);
  });

  it("keeps the (marketId, businessDate) unique index authoritative", async () => {
    const fb = await marketBySlug("faridabad");
    const times = getRoundTimes(marketScheduleOf(fb), "2026-09-06");
    await MarketRound.create({
      marketId: fb._id, businessDate: "2026-09-06",
      opensAt: times.opensAt, editCutoffAt: times.editCutoffAt, closesAt: times.closesAt, settlementStatus: "PENDING",
    });
    await expect(
      MarketRound.create({
        marketId: fb._id, businessDate: "2026-09-06",
        opensAt: times.opensAt, editCutoffAt: times.editCutoffAt, closesAt: times.closesAt, settlementStatus: "PENDING",
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("does not mutate an existing round when the market schedule later changes, but new rounds use the new schedule", async () => {
    const fb = await marketBySlug("faridabad");
    const original = await ensureMarketRound(fb, "2026-09-06");
    const originalClose = original.closesAt.toISOString();

    await Market.updateOne({ slug: "faridabad" }, { $set: { closeTimeMinutes: 1200 } }); // 20:00 IST
    const fbUpdated = await marketBySlug("faridabad");

    const sameRound = await ensureMarketRound(fbUpdated, "2026-09-06");
    expect(sameRound._id.toString()).toBe(original._id.toString());
    expect(sameRound.closesAt.toISOString()).toBe(originalClose);

    const newRound = await ensureMarketRound(fbUpdated, "2026-09-07");
    expect(newRound.closesAt.toISOString()).toBe("2026-09-07T14:30:00.000Z"); // 2026-09-07 20:00 IST
  });

  it("puts the Disawar close on the following calendar day with a 60-minute edit cutoff", async () => {
    const ds = await marketBySlug("disawar");
    const round = await ensureMarketRound(ds, "2026-09-06");
    expect(round.businessDate).toBe("2026-09-06");
    expect(round.closesAt.toISOString()).toBe("2026-09-06T21:30:00.000Z"); // 2026-09-07 03:00 IST
    expect(DateTime.fromJSDate(round.closesAt, { zone: "Asia/Kolkata" }).toISODate()).toBe("2026-09-07");
    expect(round.closesAt.getTime() - round.editCutoffAt.getTime()).toBe(60 * 60 * 1000);
  });

  it("never creates a duplicate under concurrent calls", async () => {
    const fb = await marketBySlug("faridabad");
    const results = await Promise.all(Array.from({ length: 8 }, () => ensureMarketRound(fb, "2026-10-01")));
    expect(new Set(results.map((round) => round._id.toString())).size).toBe(1);
    expect(await MarketRound.countDocuments({ marketId: fb._id, businessDate: "2026-10-01" })).toBe(1);
  });
});

describe("resolveCurrentRound", () => {
  const fbAt = async (value: string) => resolveCurrentRound(await marketBySlug("faridabad"), ist(value));
  const dsAt = async (value: string) => resolveCurrentRound(await marketBySlug("disawar"), ist(value));

  it("before open → today's round, UPCOMING", async () => {
    const resolved = await fbAt("2026-09-06T05:00:00");
    expect(resolved.round?.businessDate).toBe("2026-09-06");
    expect(resolved.state).toBe("UPCOMING");
    expect(resolved.bettingWindow).toMatchObject({ canPlaceBet: false, reason: "MARKET_NOT_OPEN" });
  });

  it("during hours → today's round, OPEN", async () => {
    expect((await fbAt("2026-09-06T12:00:00")).state).toBe("OPEN");
  });

  it("after same-day close → today's round, RESULT_PENDING", async () => {
    expect((await fbAt("2026-09-06T18:00:00")).state).toBe("RESULT_PENDING");
  });

  it("Disawar after midnight before 03:00 → previous calendar date's round, still OPEN", async () => {
    const resolved = await dsAt("2026-09-07T01:30:00");
    expect(resolved.round?.businessDate).toBe("2026-09-06");
    expect(resolved.state).toBe("OPEN");
  });

  it("Disawar after 03:00 before 07:00 → the new date's round UPCOMING; the earlier round stays closed & queryable", async () => {
    const ds = await marketBySlug("disawar");
    // The Sep 6 round is created while it is the active round...
    const active = await resolveCurrentRound(ds, ist("2026-09-06T20:00:00"));
    expect(active.round?.businessDate).toBe("2026-09-06");

    // ...and after 03:00 the current round is Sep 7, while Sep 6 remains persisted and findable.
    const later = await resolveCurrentRound(ds, ist("2026-09-07T03:30:00"));
    expect(later.round?.businessDate).toBe("2026-09-07");
    expect(later.state).toBe("UPCOMING");
    expect(await MarketRound.findOne({ marketId: ds._id, businessDate: "2026-09-06" })).not.toBeNull();
  });

  it("disabled market → no round persisted, DISABLED state", async () => {
    await Market.updateOne({ slug: "gali" }, { $set: { enabled: false } });
    const gali = await marketBySlug("gali");
    const resolved = await resolveCurrentRound(gali, ist("2026-09-06T12:00:00"));
    expect(resolved.round).toBeNull();
    expect(resolved.state).toBe("DISABLED");
    expect(resolved.bettingWindow).toMatchObject({ canPlaceBet: false, canEditBet: false, reason: "MARKET_DISABLED" });
    expect(await MarketRound.countDocuments({ marketId: gali._id })).toBe(0);
  });

  it("batched resolution creates each current round once and reuses them afterwards", async () => {
    const now = ist("2026-09-06T12:00:00");
    const markets = await listMarkets();
    await resolveCurrentRoundsForMarkets(markets, now);
    expect(await MarketRound.countDocuments()).toBe(6);
    await resolveCurrentRoundsForMarkets(markets, now);
    expect(await MarketRound.countDocuments()).toBe(6);
  });
});

describe("result read services", () => {
  it("historyWindow is an inclusive IST calendar window ending on the current business day", () => {
    expect(historyWindow("7d", ist("2026-09-20T12:00:00"))).toEqual({ startDate: "2026-09-14", endDate: "2026-09-20" });
    expect(historyWindow("30d", ist("2026-09-20T12:00:00"))).toEqual({ startDate: "2026-08-22", endDate: "2026-09-20" });
    // 05:00 IST on the 20th is still the 20th, not the 19th (UTC would disagree).
    expect(historyWindow("7d", new Date("2026-09-19T23:30:00Z")).endDate).toBe("2026-09-20");
  });

  it("getCurrentResults returns one operational round per market, pending shown as null", async () => {
    const entries = await getCurrentResults(ist("2026-09-06T12:00:00"));
    expect(entries.map((entry) => entry.slug).sort()).toEqual(
      ["delhi-bazar", "disawar", "faridabad", "gali", "ghaziabad", "shree-ganesh"].sort(),
    );
    expect(entries.every((entry) => entry.result === null)).toBe(true);
    expect(entries.find((entry) => entry.slug === "faridabad")!.state).toBe("OPEN");
  });

  it("getCurrentResults surfaces a declared result on the current round with a leading zero preserved", async () => {
    const now = ist("2026-09-06T18:30:00");
    const fb = await marketBySlug("faridabad");
    const { round } = await resolveCurrentRound(fb, now);
    round!.result = "07";
    round!.resultDeclaredAt = new Date(round!.closesAt.getTime() + 1000);
    round!.declaredByAdminId = new Types.ObjectId();
    await round!.save();

    const entry = (await getCurrentResults(now)).find((item) => item.slug === "faridabad")!;
    expect(entry.result).toBe("07");
    expect(entry.state).toBe("RESULT_DECLARED");
    expect(entry).not.toHaveProperty("declaredByAdminId");
  });

  it("getResultHistory only returns persisted result-bearing rounds inside the window, newest first", async () => {
    const now = ist("2026-09-20T12:00:00");
    for (const businessDate of ["2026-09-20", "2026-09-17", "2026-09-14", "2026-09-12", "2026-08-25", "2026-08-10", "2026-09-25"]) {
      await makeResultRound("faridabad", businessDate, "07");
    }
    await makeResultRound("gali", "2026-09-18", "31");
    // An empty (no result) round in-window must not appear.
    await ensureMarketRound(await marketBySlug("ghaziabad"), "2026-09-19");

    const sevenDay = await getResultHistory("7d", now);
    expect(sevenDay.map((entry) => entry.businessDate)).toEqual(["2026-09-20", "2026-09-18", "2026-09-17", "2026-09-14"]);
    expect(sevenDay.every((entry) => entry.result !== null)).toBe(true);

    const thirtyDay = (await getResultHistory("30d", now)).map((entry) => entry.businessDate);
    expect(thirtyDay).toContain("2026-08-25");
    expect(thirtyDay).not.toContain("2026-08-10"); // older than 30 days
    expect(thirtyDay).not.toContain("2026-09-25"); // future round must not leak
  });

  it("getResultHistory honours the market filter and rejects an unknown slug", async () => {
    const now = ist("2026-09-20T12:00:00");
    await makeResultRound("faridabad", "2026-09-19", "07");
    await makeResultRound("gali", "2026-09-19", "88");

    const fbOnly = await getResultHistory("7d", now, "faridabad");
    expect(fbOnly).toHaveLength(1);
    expect(fbOnly[0]!.slug).toBe("faridabad");

    await expect(getResultHistory("7d", now, "no-such-market")).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
  });

  it("getMarketBySlug normalises casing and 404s on unknown", async () => {
    expect((await getMarketBySlug(" Faridabad ")).slug).toBe("faridabad");
    await expect(getMarketBySlug("ghost-market")).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
  });
});
