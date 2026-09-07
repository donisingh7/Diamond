import "server-only";
import { Types } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import { User } from "@/modules/users/models/user.model";
import { Session } from "@/modules/auth/models/session.model";
import { OtpRequest } from "@/modules/auth/models/otp-request.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { BetRevision } from "@/modules/betting/models/bet-revision.model";
import { Withdrawal } from "@/modules/withdrawals/models/withdrawal.model";
import { AuditLog } from "@/modules/audit/models/audit-log.model";
import { writeAuditLog } from "@/modules/audit/services/audit-log.service";
import type { PlayerDeletionService } from "@/modules/users/services/player-deletion.contract";

const HEX24 = /^[a-f0-9]{24}$/i;

/**
 * Centralized hard purge (ADMIN_SPEC.md "PLAYER HARD DELETE", brief §15). This is the ONLY code
 * in the system that deletes financial history, and it does so ONLY as part of removing every
 * trace of one player. It is NOT a soft delete: there is no tombstone and no deny-list, so the
 * freed `loginId` may later be claimed by an entirely new, unrelated account.
 *
 * Everything below happens in ONE MongoDB transaction — a failure part-way leaves the player
 * fully intact. Deleted, in child-before-parent order:
 *   betRevisions · bets · withdrawals · walletTransactions · wallets · sessions · otpRequests ·
 *   every auditLogs row whose `subjectUserId` or `entityId` points at this player · finally the
 *   user document itself.
 *
 * A single generic `PLAYER_DELETION_COMPLETED` audit row is written afterward. It carries ONLY
 * `actorAdminId` + `action` + timestamp — no `entityId`, no `subjectUserId`, no login / name /
 * phone / id — so nothing links it back to the deleted person.
 *
 * ADMIN accounts are never purgeable here (`PLAYER_NOT_FOUND` for a non-PLAYER target).
 */
export const playerDeletionService: PlayerDeletionService = {
  async purgePlayer(input: { actorAdminId: Types.ObjectId; playerId: Types.ObjectId }): Promise<void> {
    const playerId = input.playerId;

    const target = await User.findOne({ _id: playerId, role: "PLAYER" }).lean<{ _id: Types.ObjectId }>();
    if (!target) throw new DomainError("PLAYER_NOT_FOUND", "Player not found.");

    await withTransaction(async (session) => {
      const betIds = (
        await Bet.find({ userId: playerId }).session(session).select("_id").lean<{ _id: Types.ObjectId }[]>()
      ).map((bet) => bet._id);

      await BetRevision.deleteMany(
        { $or: [{ userId: playerId }, ...(betIds.length ? [{ betId: { $in: betIds } }] : [])] },
        { session },
      );
      await Bet.deleteMany({ userId: playerId }, { session });
      await Withdrawal.deleteMany({ userId: playerId }, { session });
      await WalletTransaction.deleteMany({ userId: playerId }, { session });
      await Wallet.deleteMany({ userId: playerId }, { session });
      await Session.deleteMany({ userId: playerId }, { session });
      await OtpRequest.deleteMany({ userId: playerId }, { session });
      await AuditLog.deleteMany(
        { $or: [{ subjectUserId: playerId }, { entityId: playerId }] },
        { session },
      );

      const removed = await User.deleteOne({ _id: playerId, role: "PLAYER" }, { session });
      if (removed.deletedCount !== 1) {
        throw new DomainError("PLAYER_NOT_FOUND", "Player not found.");
      }

      await writeAuditLog(
        { actorAdminId: input.actorAdminId, action: "PLAYER_DELETION_COMPLETED", entityType: "Player" },
        session,
      );
    });
  },
};

/** Route-facing wrapper: validates the `[id]` handle, then delegates to the service boundary. */
export async function purgePlayerById(actorAdminId: Types.ObjectId, playerId: string): Promise<void> {
  const trimmed = playerId.trim();
  if (!HEX24.test(trimmed)) throw new DomainError("PLAYER_NOT_FOUND", "Player not found.");
  await playerDeletionService.purgePlayer({ actorAdminId, playerId: new Types.ObjectId(trimmed) });
}
