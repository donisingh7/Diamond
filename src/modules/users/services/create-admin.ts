import "server-only";
import { hashPassword } from "@/lib/auth/password";
import { loginIdSchema } from "../validators/identity";
import { User } from "../models/user.model";

export async function createInitialAdmin(login: string, password: string) {
  const loginId = loginIdSchema.parse(login);
  const existing = await User.findOne({ loginId });
  if (existing) {
    if (existing.role !== "ADMIN") throw new Error("Seed login ID belongs to a player; refusing role escalation.");
    return { created: false };
  }
  const passwordHash = await hashPassword(password);
  const record = new User({ role: "ADMIN", loginId, name: "Administrator", passwordHash, status: "ACTIVE", passwordChangedAt: new Date() });
  await record.validate();
  const result = await User.updateOne({ loginId }, { $setOnInsert: record.toObject() }, { upsert: true, runValidators: true });
  const stored = await User.findOne({ loginId });
  if (!stored || stored.role !== "ADMIN") throw new Error("Seed login collision; no credentials changed.");
  return { created: result.upsertedCount === 1 };
}
