import "server-only";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { DomainError } from "@/lib/errors/domain-error";
import { User } from "@/modules/users/models/user.model";
import { loginIdSchema } from "@/modules/users/validators/identity";
import { createSession, type ActiveUser } from "./session.service";

/** Real scrypt cost run against a fixed hash so a missing user/wrong portal takes the same time as a wrong password. */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword("dummy-credential-for-timing-normalization");
  return dummyHashPromise;
}

export type Portal = "PLAYER" | "ADMIN";

/**
 * Shared by both login portals; the caller declares the expected role and the server enforces it —
 * a client-supplied portal is routing information only, never authorization by itself.
 */
export async function loginWithPassword(input: { loginId: string; password: string; portal: Portal }): Promise<{ user: ActiveUser; rawToken: string }> {
  const loginId = loginIdSchema.parse(input.loginId);
  const user = await User.findOne({ loginId }).select("+passwordHash");
  if (!user || user.role !== input.portal) {
    await verifyPassword(input.password, await dummyHash());
    throw new DomainError("INVALID_CREDENTIALS", "Invalid credentials.");
  }
  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw new DomainError("INVALID_CREDENTIALS", "Invalid credentials.");
  // Disclosed only once the password itself is proven correct, per SECURITY_AND_AUTH.md's enumeration guidance.
  if (user.status !== "ACTIVE") throw new DomainError("USER_DISABLED", "Your account is disabled. Contact support.");
  const { rawToken } = await createSession(user._id);
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  return { user, rawToken };
}
