import "server-only";
import type { ClientSession } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { PlatformSettings } from "../models/platform-settings.model";

/** Read-only projection of the singleton platform configuration. No mutation API is exposed
 *  in this window — the admin game-rate endpoint belongs to a later window. */
export type PlatformSettingsView = {
  currency: string;
  timezone: string;
  minimumStakePaise: number;
  payoutMultiplier: number;
  mockDepositEnabled: boolean;
  mockOtpEnabled: boolean;
};

/**
 * Current platform settings, read from the persisted singleton. The quote engine consumes
 * `payoutMultiplier` and `minimumStakePaise` from here — NEVER a hardcoded 90 or 100 — so an
 * admin rate change (a later window) takes effect with no code change.
 *
 * Pass a `session` to read the singleton inside a caller's transaction — bet placement takes
 * the payout-multiplier snapshot this way so it reflects the persisted rate at commit time.
 */
export async function getPlatformSettings(session?: ClientSession): Promise<PlatformSettingsView> {
  const query = PlatformSettings.findOne({ key: "platform" });
  if (session) query.session(session);
  const doc = await query;
  if (!doc) {
    throw new DomainError("INTERNAL_ERROR", "Platform settings are not configured.");
  }
  return {
    currency: doc.currency,
    timezone: doc.timezone,
    minimumStakePaise: doc.minimumStakePaise,
    payoutMultiplier: doc.payoutMultiplier,
    mockDepositEnabled: doc.mockDepositEnabled,
    mockOtpEnabled: doc.mockOtpEnabled,
  };
}
