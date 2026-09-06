import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "@/lib/db/connection";
import { ensureIndexes } from "@/lib/db/models";
import { User } from "@/modules/users/models/user.model";
import { Session } from "@/modules/auth/models/session.model";
import { OtpRequest } from "@/modules/auth/models/otp-request.model";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import { hashPassword } from "@/lib/auth/password";
import { DomainError } from "@/lib/errors/domain-error";
import { loginWithPassword } from "@/modules/auth/services/login.service";
import { createSession, findActiveSessionUser, hashSessionToken, revokeAllUserSessions, revokeSessionByToken } from "@/modules/auth/services/session.service";
import { requestPlayerOtp, verifyPlayerOtp } from "@/modules/auth/services/otp.service";
import type { OtpProvider } from "@/modules/auth/providers/otp-provider";

let replica: MongoMemoryReplSet | undefined;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 0 }],
    binary: { version: "8.2.6", downloadDir: resolve("node_modules/.cache/mongodb-memory-server") },
  });
  vi.stubEnv("MONGODB_URI", replica.getUri("diamond_test_auth"));
  vi.stubEnv("SESSION_SECRET", "test-only-secret-with-at-least-32-characters");
  await connectDatabase();
  await ensureIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Session.deleteMany({}), OtpRequest.deleteMany({}), PlatformSettings.deleteMany({})]);
  await PlatformSettings.create({ key: "platform", currency: "INR", timezone: "Asia/Kolkata", minimumStakePaise: 100, payoutMultiplier: 90, mockDepositEnabled: true, mockOtpEnabled: true });
});

async function createPlayer(overrides: Partial<{ password: string; status: string; phone: string }> = {}) {
  const password = overrides.password ?? "correct-player-password";
  const passwordHash = await hashPassword(password);
  const user = await User.create({ role: "PLAYER", loginId: "player-one", name: "Player One", passwordHash, status: overrides.status ?? "ACTIVE", phone: overrides.phone ?? "9876500000" });
  return { user, password };
}
async function createAdmin(overrides: Partial<{ password: string; status: string }> = {}) {
  const password = overrides.password ?? "correct-admin-password";
  const passwordHash = await hashPassword(password);
  const user = await User.create({ role: "ADMIN", loginId: "admin-one", name: "Admin One", passwordHash, status: overrides.status ?? "ACTIVE" });
  return { user, password };
}

describe("password authentication", () => {
  it("logs a player in with correct credentials and creates a session", async () => {
    const { user, password } = await createPlayer();
    const { rawToken } = await loginWithPassword({ loginId: "player-one", password, portal: "PLAYER" });
    expect(await Session.countDocuments({ userId: user._id })).toBe(1);
    expect(rawToken).toMatch(/^[\w-]{40,}$/);
  });
  it("logs an admin in with correct credentials", async () => {
    const { password } = await createAdmin();
    const result = await loginWithPassword({ loginId: "admin-one", password, portal: "ADMIN" });
    expect(result.user.role).toBe("ADMIN");
  });
  it("rejects a wrong password", async () => {
    await createPlayer();
    await expect(loginWithPassword({ loginId: "player-one", password: "nope", portal: "PLAYER" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
  it("rejects a missing user", async () => {
    await expect(loginWithPassword({ loginId: "ghost", password: "x", portal: "PLAYER" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
  it("rejects a disabled user after verifying the password is otherwise correct", async () => {
    const { password } = await createPlayer({ status: "DISABLED" });
    await expect(loginWithPassword({ loginId: "player-one", password, portal: "PLAYER" })).rejects.toMatchObject({ code: "USER_DISABLED" });
  });
  it("rejects admin credentials submitted through the player portal", async () => {
    const { password } = await createAdmin();
    await expect(loginWithPassword({ loginId: "admin-one", password, portal: "PLAYER" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
  it("rejects player credentials submitted through the admin portal", async () => {
    const { password } = await createPlayer();
    await expect(loginWithPassword({ loginId: "player-one", password, portal: "ADMIN" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
});

describe("sessions", () => {
  it("stores only a hash of the token, never the raw value", async () => {
    const { user } = await createPlayer();
    const { rawToken } = await createSession(user._id);
    const stored = await Session.findOne({ userId: user._id }).select("+tokenHash");
    expect(stored!.tokenHash).not.toBe(rawToken);
    expect(stored!.tokenHash).toBe(hashSessionToken(rawToken));
  });
  it("accepts a valid session for an active user", async () => {
    const { user } = await createPlayer();
    const { rawToken } = await createSession(user._id);
    const resolved = await findActiveSessionUser(rawToken);
    expect(resolved?._id.toString()).toBe(user._id.toString());
  });
  it("rejects and removes an expired session", async () => {
    const { user } = await createPlayer();
    const { rawToken } = await createSession(user._id);
    await Session.updateOne({ userId: user._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await findActiveSessionUser(rawToken)).toBeNull();
    expect(await Session.countDocuments({ userId: user._id })).toBe(0);
  });
  it("rejects and removes a session pointing at a deleted user", async () => {
    const { user } = await createPlayer();
    const { rawToken } = await createSession(user._id);
    await User.deleteOne({ _id: user._id });
    expect(await findActiveSessionUser(rawToken)).toBeNull();
    expect(await Session.countDocuments()).toBe(0);
  });
  it("rejects and removes a session for a disabled user", async () => {
    const { user } = await createPlayer();
    const { rawToken } = await createSession(user._id);
    await User.updateOne({ _id: user._id }, { $set: { status: "DISABLED" } });
    expect(await findActiveSessionUser(rawToken)).toBeNull();
    expect(await Session.countDocuments()).toBe(0);
  });
  it("logs out by revoking the session so the same token no longer works", async () => {
    const { user } = await createPlayer();
    const { rawToken } = await createSession(user._id);
    await revokeSessionByToken(rawToken);
    expect(await findActiveSessionUser(rawToken)).toBeNull();
    await expect(revokeSessionByToken(rawToken)).resolves.toBeUndefined();
  });
  it("revokeAllUserSessions invalidates every session for that user", async () => {
    const { user } = await createPlayer();
    const first = await createSession(user._id);
    const second = await createSession(user._id);
    await revokeAllUserSessions(user._id);
    expect(await findActiveSessionUser(first.rawToken)).toBeNull();
    expect(await findActiveSessionUser(second.rawToken)).toBeNull();
    expect(await Session.countDocuments({ userId: user._id })).toBe(0);
  });
});

describe("OTP login", () => {
  function capturingProvider(): { provider: OtpProvider; captured: { code?: string } } {
    const captured: { code?: string } = {};
    return { provider: { send: async ({ code }) => { captured.code = code; } }, captured };
  }

  it("creates a request for a registered active player and never persists the raw code", async () => {
    const { user } = await createPlayer();
    const { provider, captured } = capturingProvider();
    const { requestId } = await requestPlayerOtp(user.phone!, provider);
    expect(captured.code).toMatch(/^\d{6}$/);
    const stored = await OtpRequest.findById(requestId).select("+codeHash");
    expect(stored).not.toBeNull();
    expect(stored!.codeHash).not.toBe(captured.code);
    expect(JSON.stringify(stored!.toObject())).not.toContain(captured.code!);
  });
  it("returns a decoy request id for an unregistered phone without creating a record", async () => {
    const { provider } = capturingProvider();
    await requestPlayerOtp("0000000000", provider);
    expect(await OtpRequest.countDocuments()).toBe(0);
  });
  it("returns a decoy request id for a disabled player without creating a record", async () => {
    await createPlayer({ status: "DISABLED" });
    const disabled = await User.findOne({ loginId: "player-one" });
    const { provider } = capturingProvider();
    await requestPlayerOtp(disabled!.phone!, provider);
    expect(await OtpRequest.countDocuments()).toBe(0);
  });
  it("never creates a record for an admin's phone (OTP is player-only)", async () => {
    const admin = await User.create({ role: "ADMIN", loginId: "admin-otp", name: "Admin", passwordHash: await hashPassword("x"), phone: "9999999999" });
    const { provider } = capturingProvider();
    await requestPlayerOtp(admin.phone!, provider);
    expect(await OtpRequest.countDocuments()).toBe(0);
  });
  it("verifies a correct code and creates a session", async () => {
    const { user } = await createPlayer();
    const { provider, captured } = capturingProvider();
    const { requestId } = await requestPlayerOtp(user.phone!, provider);
    const { user: verifiedUser, rawToken } = await verifyPlayerOtp(requestId, captured.code!);
    expect(verifiedUser._id.toString()).toBe(user._id.toString());
    expect(await findActiveSessionUser(rawToken)).not.toBeNull();
  });
  it("rejects an invalid code and records the attempt", async () => {
    const { user } = await createPlayer();
    const { provider } = capturingProvider();
    const { requestId } = await requestPlayerOtp(user.phone!, provider);
    await expect(verifyPlayerOtp(requestId, "000000")).rejects.toMatchObject({ code: "INVALID_OTP" });
    expect((await OtpRequest.findById(requestId))!.attempts).toBe(1);
  });
  it("locks out after the maximum number of incorrect attempts, even with the correct code", async () => {
    const { user } = await createPlayer();
    const { provider, captured } = capturingProvider();
    const { requestId } = await requestPlayerOtp(user.phone!, provider);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(verifyPlayerOtp(requestId, "000000")).rejects.toMatchObject({ code: "INVALID_OTP" });
    }
    await expect(verifyPlayerOtp(requestId, captured.code!)).rejects.toMatchObject({ code: "INVALID_OTP" });
  });
  it("rejects an expired code", async () => {
    const { user } = await createPlayer();
    const { provider, captured } = capturingProvider();
    const { requestId } = await requestPlayerOtp(user.phone!, provider);
    await OtpRequest.updateOne({ _id: requestId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(verifyPlayerOtp(requestId, captured.code!)).rejects.toMatchObject({ code: "INVALID_OTP" });
  });
  it("cannot consume the same OTP twice", async () => {
    const { user } = await createPlayer();
    const { provider, captured } = capturingProvider();
    const { requestId } = await requestPlayerOtp(user.phone!, provider);
    await verifyPlayerOtp(requestId, captured.code!);
    await expect(verifyPlayerOtp(requestId, captured.code!)).rejects.toMatchObject({ code: "INVALID_OTP" });
    expect(await Session.countDocuments({ userId: user._id })).toBe(1);
  });
  it("rejects verification with an invalid/unknown request id", async () => {
    await expect(verifyPlayerOtp(new Types.ObjectId().toHexString(), "123456")).rejects.toMatchObject({ code: "INVALID_OTP" });
    await expect(verifyPlayerOtp("not-an-object-id", "123456")).rejects.toMatchObject({ code: "INVALID_OTP" });
  });
});

describe("DomainError propagation", () => {
  it("is the error type thrown on rejection paths", async () => {
    await createPlayer();
    try {
      await loginWithPassword({ loginId: "player-one", password: "wrong", portal: "PLAYER" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
    }
  });
});
