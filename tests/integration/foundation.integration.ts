import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectDatabase, withTransaction } from "@/lib/db/connection";
import { ensureIndexes, models } from "@/lib/db/models";
import { seedFoundation } from "@/modules/settings/services/seed-foundation";
import { createInitialAdmin } from "@/modules/users/services/create-admin";
import { User } from "@/modules/users/models/user.model";
import { Market } from "@/modules/markets/models/market.model";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { verifyPassword } from "@/lib/auth/password";

let replica: MongoMemoryReplSet | undefined;
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  // Never load the user's .env or use their configured database in this suite.
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_foundation"));
  await connectDatabase();
  await ensureIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
  vi.unstubAllEnvs();
});

describe("real replica-set foundation", () => {
  it("runs the actual seed/create-admin CLI scripts with environment credentials", async () => {
    const run = promisify(execFile);
    const options = { windowsHide: true, env: { ...process.env,
      MONGODB_URI: replica!.getUri("diamond_test_foundation"),
      SEED_ADMIN_LOGIN_ID: "cli-admin", SEED_ADMIN_PASSWORD: "cli-integration-password",
    } };
    const first = await run(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/seed.ts"], options);
    expect(first.stdout).toContain("admin created");
    const second = await run(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/seed.ts"], options);
    expect(second.stdout).toContain("admin preserved");
    const independent = await run(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/create-admin.ts"], options);
    expect(independent.stdout).toContain("Existing admin preserved");
    expect(await User.countDocuments({ loginId: "cli-admin" })).toBe(1);
  });
  it("creates all collection indexes and rejects duplicate ledger keys", async () => {
    for (const model of models) expect((await model.collection.indexes()).length).toBeGreaterThan(1);
    const values = {
      userId: new mongoose.Types.ObjectId(), walletId: new mongoose.Types.ObjectId(), type: "MOCK_DEPOSIT",
      amountPaise: 100, availableDeltaPaise: 100, reservedDeltaPaise: 0,
      availableBeforePaise: 0, availableAfterPaise: 100, reservedBeforePaise: 0, reservedAfterPaise: 0,
      idempotencyKey: "integration:duplicate",
    };
    await WalletTransaction.create(values);
    await expect(WalletTransaction.create(values)).rejects.toMatchObject({ code: 11000 });
  });
  it("reruns seed without duplicates or overwriting changed configuration", async () => {
    await seedFoundation(); await seedFoundation();
    expect(await Market.countDocuments()).toBe(6);
    expect(await PlatformSettings.countDocuments()).toBe(1);
    expect(await Market.findOne({ slug: "disawar" }).lean()).toMatchObject({ closeDayOffset: 1, openTimeMinutes: 420, closeTimeMinutes: 180 });
    await Market.updateOne({ slug: "gali" }, { $set: { enabled: false } });
    await PlatformSettings.updateOne({ key: "platform" }, { $set: { payoutMultiplier: 95 } });
    await seedFoundation();
    expect((await Market.findOne({ slug: "gali" }))?.enabled).toBe(false);
    expect((await PlatformSettings.findOne({ key: "platform" }))?.payoutMultiplier).toBe(95);
  });
  it("creates an admin, hashes its password and preserves credentials on rerun", async () => {
    const password = "integration-only-password";
    expect(await createInitialAdmin(" Admin-Example ", password)).toEqual({ created: true });
    const admin = await User.findOne({ loginId: "admin-example" }).select("+passwordHash");
    expect(admin?.role).toBe("ADMIN");
    expect(await verifyPassword(password, admin!.passwordHash)).toBe(true);
    expect(await createInitialAdmin("ADMIN-EXAMPLE", "different-test-password")).toEqual({ created: false });
    const preserved = await User.findOne({ loginId: "admin-example" }).select("+passwordHash");
    expect(preserved!.passwordHash).toBe(admin!.passwordHash);
    expect(await User.countDocuments({ loginId: "admin-example" })).toBe(1);
    expect(await Wallet.countDocuments({ userId: admin!._id })).toBe(0);
  });
  it("does not promote a player when the seed login collides", async () => {
    await User.create({ role: "PLAYER", loginId: "existing-player", name: "Test player", passwordHash: "test-fixture" });
    await expect(createInitialAdmin("EXISTING-PLAYER", "integration-only-password")).rejects.toThrow("refusing role escalation");
    expect((await User.findOne({ loginId: "existing-player" }))?.role).toBe("PLAYER");
  });
  it("rolls back multi-document changes on failure and commits successful work", async () => {
    await expect(withTransaction(async (session) => {
      const [player] = await User.create([{ role: "PLAYER", loginId: "rolled-back", name: "Rollback", passwordHash: "test-fixture" }], { session });
      await Wallet.create([{ userId: player._id }], { session });
      throw new Error("deliberate rollback");
    })).rejects.toThrow("deliberate rollback");
    expect(await User.findOne({ loginId: "rolled-back" })).toBeNull();
    expect(await Wallet.countDocuments()).toBe(0);
    await withTransaction(async (session) => {
      const [player] = await User.create([{ role: "PLAYER", loginId: "committed", name: "Committed", passwordHash: "test-fixture" }], { session });
      await Wallet.create([{ userId: player._id }], { session });
    });
    expect(await User.findOne({ loginId: "committed" })).not.toBeNull();
    expect(await Wallet.countDocuments()).toBe(1);
  });
});
