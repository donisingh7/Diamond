import { connectDatabase } from "../src/lib/db/connection";
import { ensureIndexes, models } from "../src/lib/db/models";
import { seedFoundation } from "../src/modules/settings/services/seed-foundation";
import { PlatformSettings } from "../src/modules/settings/models/platform-settings.model";
import { Market } from "../src/modules/markets/models/market.model";
import { runScript } from "./runtime";

/**
 * `npm run db:provision` — NON-DESTRUCTIVE, idempotent, safe to rerun.
 *
 * Ensures the configured MongoDB is fully shaped so every canonical collection is visible in
 * Atlas / Compass / Explorer even when empty:
 *   1. creates any of the 12 canonical collections that do not yet exist (never drops one),
 *   2. ensures every declared index via `createIndexes` — additive only, it never drops a live
 *      or unknown index the way `syncIndexes` would,
 *   3. ensures the foundational six markets + the platform-settings singleton via `$setOnInsert`
 *      upserts — a value an operator later customized is left untouched.
 *
 * It does NOT delete users / wallets / bets / withdrawals or reset anything. It prints
 * collection names, counts and index counts only — never the URI or any credential.
 */

const CANONICAL_COLLECTIONS = [
  "users",
  "sessions",
  "otpRequests",
  "wallets",
  "walletTransactions",
  "markets",
  "marketRounds",
  "bets",
  "betRevisions",
  "withdrawals",
  "auditLogs",
  "platformSettings",
] as const;

void runScript(async () => {
  const mongoose = await connectDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database handle unavailable after connect.");

  const registered = [...models.map((model) => model.collection.collectionName)].sort();
  const expected = [...CANONICAL_COLLECTIONS].sort();
  if (JSON.stringify(registered) !== JSON.stringify(expected)) {
    throw new Error("Model registry does not match the 12 canonical collections; aborting provisioning.");
  }

  const present = new Set((await db.listCollections().toArray()).map((collection) => collection.name));
  let createdThisRun = 0;
  for (const name of CANONICAL_COLLECTIONS) {
    if (present.has(name)) continue;
    try {
      await db.createCollection(name);
      createdThisRun += 1;
    } catch (error) {
      const info = error as { code?: number; codeName?: string };
      if (info.code !== 48 && info.codeName !== "NamespaceExists") throw error;
    }
  }

  await ensureIndexes();
  await seedFoundation();

  const finalNames = (await db.listCollections().toArray()).map((collection) => collection.name).sort();
  console.log(`Provisioned database "${mongoose.connection.name}".`);
  console.log(`Canonical collections created this run: ${createdThisRun}.`);
  console.log(`Collections present (${finalNames.length}): ${finalNames.join(", ")}`);
  for (const model of models) {
    const indexes = await model.collection.indexes();
    console.log(`  ${model.collection.collectionName}: ${indexes.length} index(es)`);
  }
  console.log(`platformSettings singleton: ${(await PlatformSettings.countDocuments({ key: "platform" })) === 1 ? "present" : "MISSING"}`);
  console.log(`markets: ${await Market.countDocuments()} (expected >= 6)`);
});
