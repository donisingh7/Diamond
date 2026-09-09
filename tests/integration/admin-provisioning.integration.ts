import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "@/lib/db/connection";
import { models } from "@/lib/db/models";
import { User } from "@/modules/users/models/user.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { loginWithPassword } from "@/modules/auth/services/login.service";

/**
 * Exercises the real `npm run db:provision` and `npm run db:seed-demo` CLIs against a disposable
 * replica set, plus demo-account login verification. The user's configured `.env` / database is
 * NEVER touched here — a fresh `mongodb-memory-server` instance only. Test-only demo passwords
 * are used (not the deployed values), so no real credential enters this source file.
 */

const run = promisify(execFile);
// Runs from the worktree root so tsx resolves `tsconfig.json` and the `@/` alias. The
// DEMO_SEED_ENABLED guard test assumes no worktree `.env` sets that flag — true for a clean
// checkout (`.env` is gitignored) and for the committed `.env.example` (blank placeholder).
function cliArgs(scriptFile: string): string[] {
  return ["--conditions=react-server", "--import", "tsx", `scripts/${scriptFile}`];
}

// Test-only demo credentials — deliberately NOT the deployed demo values.
const DEMO = {
  DEMO_PLAYER_PHONE: "9000000001",
  DEMO_PLAYER_PASSWORD: "demo-player-pw",
  DEMO_ADMIN_DONI_PASSWORD: "demo-doni-pw",
  DEMO_ADMIN_PANKAJ_PASSWORD: "demo-pankaj-pw",
  DEMO_ADMIN_GOPAL_PASSWORD: "demo-gopal-pw",
};

const CANONICAL = [
  "users", "sessions", "otpRequests", "wallets", "walletTransactions", "markets",
  "marketRounds", "bets", "betRevisions", "withdrawals", "auditLogs", "platformSettings",
  "paymentMethods", "depositRequests", "proofImages",
];

let replica: MongoMemoryReplSet | undefined;
let baseUri = "";

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  baseUri = replica.getUri();
  vi.stubEnv("SESSION_SECRET", "test-only-secret-with-at-least-32-characters");
}, 900_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
  vi.unstubAllEnvs();
});

function uriFor(dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function collectionNames(dbName: string): Promise<string[]> {
  const conn = mongoose.createConnection(uriFor(dbName));
  await conn.asPromise();
  try {
    return (await conn.db!.listCollections().toArray()).map((c) => c.name).sort();
  } finally {
    await conn.close();
  }
}

// --------------------------------------------------------------------------------------------
describe("npm run db:provision", () => {
  it("first run ensures all 15 canonical collections; a second run is a non-destructive no-op", async () => {
    const dbName = "diamond_test_provision";
    const env = { ...process.env, MONGODB_URI: uriFor(dbName) };

    const first = await run(process.execPath, cliArgs("provision-db.ts"), { windowsHide: true, env });
    expect(first.stdout).toContain("Collections present (15)");
    for (const name of CANONICAL) expect(first.stdout).toContain(name);

    expect(await collectionNames(dbName)).toEqual([...CANONICAL].sort());

    // A value an operator customized after provisioning must survive a rerun.
    const conn = mongoose.createConnection(uriFor(dbName));
    await conn.asPromise();
    await conn.collection("markets").updateOne({ slug: "gali" }, { $set: { enabled: false } });
    await conn.collection("platformSettings").updateOne({ key: "platform" }, { $set: { payoutMultiplier: 77 } });
    await conn.close();

    const second = await run(process.execPath, cliArgs("provision-db.ts"), { windowsHide: true, env });
    expect(second.stdout).toContain("Canonical collections created this run: 0");
    expect(second.stdout).toContain("Collections present (15)");

    const check = mongoose.createConnection(uriFor(dbName));
    await check.asPromise();
    const gali = await check.collection("markets").findOne({ slug: "gali" });
    const settings = await check.collection("platformSettings").findOne({ key: "platform" });
    const marketCount = await check.collection("markets").countDocuments();
    await check.close();
    expect(gali?.enabled).toBe(false);
    expect(settings?.payoutMultiplier).toBe(77);
    expect(marketCount).toBe(6);
  }, 120_000);
});

// --------------------------------------------------------------------------------------------
describe("npm run db:seed-demo", () => {
  it("refuses to run without the DEMO_SEED_ENABLED safety flag and writes nothing", async () => {
    const dbName = "diamond_test_seed_guard";
    const env = { ...process.env, MONGODB_URI: uriFor(dbName), ...DEMO };
    delete (env as Record<string, string | undefined>).DEMO_SEED_ENABLED;

    await expect(
      run(process.execPath, cliArgs("seed-demo.ts"), { windowsHide: true, env }),
    ).rejects.toMatchObject({ code: 1 });

    const conn = mongoose.createConnection(uriFor(dbName));
    await conn.asPromise();
    const users = await conn.db!.listCollections({ name: "users" }).toArray();
    const userCount = users.length ? await conn.collection("users").countDocuments() : 0;
    await conn.close();
    expect(userCount).toBe(0);
  }, 60_000);

  it("first run creates 4 hashed accounts + the ₹10,000 opening ADMIN_CREDIT; a rerun adds nothing", async () => {
    const dbName = "diamond_test_seed_demo";
    const env = { ...process.env, MONGODB_URI: uriFor(dbName), DEMO_SEED_ENABLED: "true", ...DEMO };

    const first = await run(process.execPath, cliArgs("seed-demo.ts"), { windowsHide: true, env });
    expect(first.stdout).toContain("created 4");
    expect(first.stdout).toContain("opening credit: applied");
    expect(first.stdout).not.toContain("demo-player-pw");

    vi.stubEnv("MONGODB_URI", uriFor(dbName));
    await connectDatabase();

    const player = await User.findOne({ loginId: "test1" }).select("+passwordHash");
    expect(player?.role).toBe("PLAYER");
    expect(player?.status).toBe("ACTIVE");
    expect(player!.passwordHash).toMatch(/^scrypt-v1\$/);
    for (const loginId of ["doni", "pankaj", "gopal"]) {
      const admin = await User.findOne({ loginId }).select("+passwordHash");
      expect(admin?.role).toBe("ADMIN");
      expect(admin!.passwordHash).toMatch(/^scrypt-v1\$/);
    }
    expect(await Wallet.countDocuments({ userId: { $in: (await User.find({ role: "ADMIN" })).map((u) => u._id) } })).toBe(0);

    const wallet = await Wallet.findOne({ userId: player!._id }).lean();
    expect(wallet).toMatchObject({ availableBalancePaise: 1_000_000, reservedBalancePaise: 0, currency: "INR" });

    const opening = await WalletTransaction.find({ userId: player!._id, type: "ADMIN_CREDIT" }).lean();
    expect(opening).toHaveLength(1);
    expect(opening[0]).toMatchObject({ amountPaise: 1_000_000, idempotencyKey: "ADMIN_CREDIT:DEMO_OPENING_BALANCE:test1:v1" });

    // Rerun: no duplicate accounts, no second opening credit, balance unchanged.
    const second = await run(process.execPath, cliArgs("seed-demo.ts"), { windowsHide: true, env });
    expect(second.stdout).toContain("preserved 4");
    expect(second.stdout).toContain("opening credit: already-present");
    expect(await User.countDocuments({ loginId: { $in: ["test1", "doni", "pankaj", "gopal"] } })).toBe(4);
    expect(await WalletTransaction.countDocuments({ userId: player!._id, type: "ADMIN_CREDIT" })).toBe(1);
    expect((await Wallet.findOne({ userId: player!._id }).lean())!.availableBalancePaise).toBe(1_000_000);

    // ---- login verification (brief §26) ----
    const asPlayer = await loginWithPassword({ loginId: "test1", password: DEMO.DEMO_PLAYER_PASSWORD, portal: "PLAYER" });
    expect(asPlayer.user.role).toBe("PLAYER");
    for (const [loginId, password] of [
      ["doni", DEMO.DEMO_ADMIN_DONI_PASSWORD],
      ["pankaj", DEMO.DEMO_ADMIN_PANKAJ_PASSWORD],
      ["gopal", DEMO.DEMO_ADMIN_GOPAL_PASSWORD],
    ] as const) {
      const asAdmin = await loginWithPassword({ loginId, password, portal: "ADMIN" });
      expect(asAdmin.user.role).toBe("ADMIN");
    }
    // cross-role rejection still holds
    await expect(
      loginWithPassword({ loginId: "test1", password: DEMO.DEMO_PLAYER_PASSWORD, portal: "ADMIN" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(
      loginWithPassword({ loginId: "doni", password: DEMO.DEMO_ADMIN_DONI_PASSWORD, portal: "PLAYER" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    await mongoose.disconnect();
  }, 120_000);

  it("fails safely when a requested login already exists with a different role (no repurpose)", async () => {
    const dbName = "diamond_test_seed_conflict";
    const conn = mongoose.createConnection(uriFor(dbName));
    await conn.asPromise();
    await conn.collection("users").insertOne({
      role: "PLAYER", loginId: "doni", name: "Real Player", passwordHash: "scrypt-v1$aa$bb", status: "ACTIVE",
      createdAt: new Date(), updatedAt: new Date(),
    });
    await conn.close();

    const env = { ...process.env, MONGODB_URI: uriFor(dbName), DEMO_SEED_ENABLED: "true", ...DEMO };
    await expect(
      run(process.execPath, cliArgs("seed-demo.ts"), { windowsHide: true, env }),
    ).rejects.toMatchObject({ code: 1 });

    const check = mongoose.createConnection(uriFor(dbName));
    await check.asPromise();
    const doni = await check.collection("users").findOne({ loginId: "doni" });
    const total = await check.collection("users").countDocuments();
    await check.close();
    expect(doni?.role).toBe("PLAYER"); // untouched
    expect(total).toBe(1); // no test1 / pankaj / gopal written
  }, 60_000);
});

// --------------------------------------------------------------------------------------------
describe("model registry", () => {
  it("still registers exactly the 15 canonical collections (no competing collection added)", () => {
    expect(models.map((m) => m.collection.collectionName).sort()).toEqual([...CANONICAL].sort());
    expect(Types.ObjectId.isValid(new Types.ObjectId())).toBe(true);
  });
});
