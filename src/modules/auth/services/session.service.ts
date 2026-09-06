import "server-only";
import { randomBytes, createHmac } from "node:crypto";
import type { ClientSession, HydratedDocument, Types } from "mongoose";
import { getSessionSecret } from "@/lib/config/env";
import { User, type UserRecord } from "@/modules/users/models/user.model";
import { Session } from "../models/session.model";
import { SESSION_DURATION_MS } from "../config";

export type ActiveUser = HydratedDocument<UserRecord>;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** HMAC pepper mirrors the OTP hash strategy; only the hash is ever persisted. */
export function hashSessionToken(rawToken: string): string {
  return createHmac("sha256", getSessionSecret()).update(rawToken).digest("hex");
}

export async function createSession(userId: Types.ObjectId, mongoSession?: ClientSession): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await Session.create([{ userId, tokenHash, expiresAt }], { session: mongoSession });
  return { rawToken, expiresAt };
}

/**
 * Every protected request rechecks existence/status here — TTL cleanup is asynchronous and
 * never an authorization mechanism. A stale session pointing at a missing/disabled user is
 * revoked on sight so an old cookie cannot keep working after admin disables/deletes the user.
 */
export async function findActiveSessionUser(rawToken: string): Promise<ActiveUser | null> {
  const tokenHash = hashSessionToken(rawToken);
  const session = await Session.findOne({ tokenHash });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }
  const user = await User.findById(session.userId);
  if (!user || user.status !== "ACTIVE") {
    await Session.deleteOne({ _id: session._id });
    return null;
  }
  void Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).exec();
  return user;
}

export async function revokeSessionByToken(rawToken: string): Promise<void> {
  await Session.deleteOne({ tokenHash: hashSessionToken(rawToken) });
}

/** Reusable primitive for future password reset/change and admin disable/delete flows. */
export async function revokeAllUserSessions(userId: Types.ObjectId): Promise<void> {
  await Session.deleteMany({ userId });
}
