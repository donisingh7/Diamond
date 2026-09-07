import "server-only";
import { Types } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import { writeAuditLog } from "@/modules/audit/services/audit-log.service";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import { getPlatformSettings } from "@/modules/settings/services/platform-settings.service";

/**
 * Admin platform payout-rate management (Window 6A2). The rate is the persisted
 * `platformSettings.payoutMultiplier` singleton (currently `90`). Bet placement snapshots the
 * live multiplier into `bets.payoutMultiplierSnapshot` at commit time, so:
 *
 *   - a rate change affects ONLY future bet placements;
 *   - every existing `Bet` keeps its own `payoutMultiplierSnapshot` — this service NEVER mass-
 *     updates historical bets, and Window 7A settlement will use each bet's stored snapshot.
 *
 * Update is server-authoritative (the request cannot supply a resulting value), validated, and
 * writes a `PAYOUT_RATE_UPDATED` audit row with safe before/after values. Setting the rate to
 * its current value is a no-op that writes no audit row.
 */

export type PayoutRateView = {
  payoutMultiplier: number;
  currency: string;
  minimumStakePaise: number;
  serverNow: string;
};

export async function getPayoutRate(now: Date = new Date()): Promise<PayoutRateView> {
  const settings = await getPlatformSettings();
  return {
    payoutMultiplier: settings.payoutMultiplier,
    currency: settings.currency,
    minimumStakePaise: settings.minimumStakePaise,
    serverNow: now.toISOString(),
  };
}

export type UpdatePayoutRateInput = {
  actorAdminId: Types.ObjectId;
  payoutMultiplier: number;
};

export type UpdatePayoutRateResult = PayoutRateView & {
  previousPayoutMultiplier: number;
  changed: boolean;
};

export async function updatePayoutRate(
  input: UpdatePayoutRateInput,
  now: Date = new Date(),
): Promise<UpdatePayoutRateResult> {
  if (!Number.isInteger(input.payoutMultiplier) || input.payoutMultiplier < 1) {
    throw new DomainError("INVALID_INPUT", "The payout multiplier must be a positive integer.");
  }
  const current = await getPlatformSettings();
  const previous = current.payoutMultiplier;

  if (previous === input.payoutMultiplier) {
    return { ...(await getPayoutRate(now)), previousPayoutMultiplier: previous, changed: false };
  }

  await withTransaction(async (session) => {
    const res = await PlatformSettings.updateOne(
      { key: "platform" },
      { $set: { payoutMultiplier: input.payoutMultiplier } },
      { session, runValidators: true },
    );
    if (res.matchedCount !== 1) {
      throw new DomainError("INTERNAL_ERROR", "Platform settings are not configured.");
    }
    await writeAuditLog(
      {
        actorAdminId: input.actorAdminId,
        action: "PAYOUT_RATE_UPDATED",
        entityType: "PlatformSettings",
        before: { payoutMultiplier: previous },
        after: { payoutMultiplier: input.payoutMultiplier },
      },
      session,
    );
  });

  return { ...(await getPayoutRate(now)), previousPayoutMultiplier: previous, changed: true };
}
