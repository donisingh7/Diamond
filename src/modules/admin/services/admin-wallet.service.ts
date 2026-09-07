import "server-only";
import { Types, type QueryFilter } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import {
  WalletTransaction,
  type WalletTransactionRow,
  type WalletTransactionDoc,
} from "@/modules/wallet/models/wallet-transaction.model";
import {
  applyWalletMovement,
  assertMovementAmount,
  createPlayerWallet,
  getTransactionByIdempotencyKey,
  getWalletDoc,
  isDuplicateKeyError,
  toWalletView,
  type WalletView,
} from "@/modules/wallet/services/wallet.service";
import {
  clampWalletTransactionsLimit,
  decodeWalletCursor,
  encodeWalletCursor,
} from "@/modules/wallet/services/wallet-transactions.service";
import { writeAuditLog } from "@/modules/audit/services/audit-log.service";
import { resolvePlayer } from "./admin-player.service";

/**
 * Admin manual wallet movement — the LOCKED V1 deposit / correction workflow (brief §16–§21).
 * There is no payment gateway anywhere in V1: a player pays the admin OUTSIDE Diamond
 * (UPI / cash / bank), the admin verifies it, then credits the Diamond wallet here, and the
 * system records an immutable `ADMIN_CREDIT`. `ADMIN_DEBIT` is the mirror for corrections /
 * reversals of an accidental credit.
 *
 * Guarantees:
 *  - wallet balance change + immutable `walletTransactions` row + admin `auditLogs` row are ONE
 *    MongoDB transaction — a failure anywhere moves no money (§19).
 *  - the resulting balance is computed by the wallet core, never accepted from the caller (§16).
 *  - `ADMIN_DEBIT` filters on `availableBalancePaise >= amount`, so available can never go
 *    negative and `reservedBalancePaise` is never touched (§17).
 *  - idempotent on `(actorAdminId, clientRequestId)`: an exact replay returns the original
 *    result; the same request id with a different player / operation / amount / reason /
 *    reference is `DUPLICATE_REQUEST`, backed by the unique `idempotencyKey` index (§18).
 *  - previous ledger rows are never edited or deleted — a correction is a new compensating row.
 */

/** ₹1, matching every other money entry point in the system. */
export const ADMIN_WALLET_MINIMUM_PAISE = 100;
export const ADMIN_ADJUSTMENT_REFERENCE_TYPE = "ADMIN_ADJUSTMENT";

/**
 * Operation-AGNOSTIC on purpose: credit and debit share one key namespace so reusing a request
 * id for the other operation collides (`assertSameOperation` in the wallet core sees a different
 * `type`) instead of silently succeeding as a second movement (§18).
 */
export function buildAdminAdjustmentKey(adminId: Types.ObjectId, clientRequestId: string): string {
  return `ADMIN_WALLET_ADJUSTMENT:${adminId.toHexString()}:${clientRequestId}`;
}

export function assertAdminAdjustmentAmount(amountPaise: number): number {
  assertMovementAmount(amountPaise);
  if (amountPaise < ADMIN_WALLET_MINIMUM_PAISE) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `Minimum manual wallet adjustment is ${ADMIN_WALLET_MINIMUM_PAISE} paise (₹1).`,
    );
  }
  return amountPaise;
}

export type AdminAdjustmentType = "ADMIN_CREDIT" | "ADMIN_DEBIT";

export type AdminWalletAdjustmentServiceInput = {
  actorAdminId: Types.ObjectId;
  playerId: string;
  amountPaise: number;
  reason: string;
  paymentReference?: string;
  clientRequestId: string;
};

/** Test seams — production passes neither. */
export type AdminWalletMutationOptions = {
  clock?: () => Date;
  /** Invoked inside the transaction right after the wallet movement, to force a rollback (§19). */
  afterWalletMovement?: () => void;
};

export type AdminWalletAdjustmentResult = {
  transaction: { id: string; type: AdminAdjustmentType; amountPaise: number };
  wallet: WalletView;
  /** `true` when this call recovered an already-applied movement instead of moving money again. */
  idempotentReplay: boolean;
  serverNow: string;
};

type Fingerprint = {
  type: AdminAdjustmentType;
  playerId: Types.ObjectId;
  amountPaise: number;
  reason: string;
  paymentReference?: string;
};

const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") === (b ?? "");

async function recoverReceipt(
  tx: WalletTransactionDoc,
  fingerprint: Fingerprint,
  clock: () => Date,
): Promise<AdminWalletAdjustmentResult> {
  if (
    tx.type !== fingerprint.type
    || tx.amountPaise !== fingerprint.amountPaise
    || !tx.userId.equals(fingerprint.playerId)
    || !sameText(tx.adminReason, fingerprint.reason)
    || !sameText(tx.adminPaymentReference, fingerprint.paymentReference)
  ) {
    throw new DomainError(
      "DUPLICATE_REQUEST",
      "This request id was already used for a different wallet adjustment.",
    );
  }
  const wallet = await getWalletDoc(fingerprint.playerId);
  return {
    transaction: { id: tx._id.toHexString(), type: fingerprint.type, amountPaise: fingerprint.amountPaise },
    wallet: toWalletView(wallet),
    idempotentReplay: true,
    serverNow: clock().toISOString(),
  };
}

async function adjust(
  type: AdminAdjustmentType,
  input: AdminWalletAdjustmentServiceInput,
  options: AdminWalletMutationOptions,
): Promise<AdminWalletAdjustmentResult> {
  const clock = options.clock ?? (() => new Date());
  const player = await resolvePlayer(input.playerId);
  const amountPaise = assertAdminAdjustmentAmount(input.amountPaise);
  const reason = input.reason.trim();
  if (!reason) {
    throw new DomainError("INVALID_INPUT", "A reason is required for a manual wallet adjustment.");
  }
  const paymentReference = input.paymentReference?.trim() || undefined;
  const fingerprint: Fingerprint = { type, playerId: player._id, amountPaise, reason, paymentReference };

  await createPlayerWallet(player._id);
  const idempotencyKey = buildAdminAdjustmentKey(input.actorAdminId, input.clientRequestId);

  const prior = await getTransactionByIdempotencyKey(idempotencyKey);
  if (prior) return recoverReceipt(prior, fingerprint, clock);

  try {
    const movement = await withTransaction(async (session) => {
      const result = await applyWalletMovement(
        {
          userId: player._id,
          type,
          amountPaise,
          idempotencyKey,
          referenceType: ADMIN_ADJUSTMENT_REFERENCE_TYPE,
          actorAdminId: input.actorAdminId,
          adminReason: reason,
          adminPaymentReference: paymentReference,
        },
        session,
      );
      options.afterWalletMovement?.();
      // On the in-transaction idempotent-replay path (a write-conflict retry that now sees the
      // original committed movement) the money already moved AND its audit row already exists —
      // writing another here would double-audit a single adjustment.
      if (!result.idempotentReplay) {
        await writeAuditLog(
          {
            actorAdminId: input.actorAdminId,
            action: type === "ADMIN_CREDIT" ? "ADMIN_WALLET_CREDIT" : "ADMIN_WALLET_DEBIT",
            entityType: "Wallet",
            subjectUserId: player._id,
            after: {
              amountPaise,
              reason,
              paymentReference: paymentReference ?? null,
              availableBalancePaise: result.availableBalancePaise,
              reservedBalancePaise: result.reservedBalancePaise,
            },
          },
          session,
        );
      }
      return result;
    });

    return {
      transaction: { id: movement.transactionId.toHexString(), type, amountPaise },
      wallet: toWalletView({
        currency: "INR",
        availableBalancePaise: movement.availableBalancePaise,
        reservedBalancePaise: movement.reservedBalancePaise,
      }),
      idempotentReplay: movement.idempotentReplay,
      serverNow: clock().toISOString(),
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const raced = await getTransactionByIdempotencyKey(idempotencyKey);
      if (raced) return recoverReceipt(raced, fingerprint, clock);
    }
    throw error;
  }
}

/**
 * Manual credit — the operational deposit. `available += amount`, one `ADMIN_CREDIT` ledger row
 * carrying `reason` + optional `paymentReference` + the acting admin id, one
 * `ADMIN_WALLET_CREDIT` audit row. Target must be a PLAYER (`PLAYER_NOT_FOUND` otherwise).
 */
export function adminCreditWallet(
  input: AdminWalletAdjustmentServiceInput,
  options: AdminWalletMutationOptions = {},
): Promise<AdminWalletAdjustmentResult> {
  return adjust("ADMIN_CREDIT", input, options);
}

/**
 * Manual debit — correction / reversal of an accidental credit. `available -= amount` (never
 * below zero → `INSUFFICIENT_BALANCE`), `reserved` untouched, one `ADMIN_DEBIT` ledger row, one
 * `ADMIN_WALLET_DEBIT` audit row. The earlier credit row is never edited — this is a new
 * compensating entry.
 */
export function adminDebitWallet(
  input: AdminWalletAdjustmentServiceInput,
  options: AdminWalletMutationOptions = {},
): Promise<AdminWalletAdjustmentResult> {
  return adjust("ADMIN_DEBIT", input, options);
}

// --- admin ledger read ------------------------------------------------------------------

/**
 * Admin-only ledger view. Same rows as the player sees PLUS the operational metadata a future
 * admin screen needs — `reason`, `paymentReference`, `actorAdminId` — but NEVER the internal
 * `idempotencyKey` (brief §22).
 */
export type AdminWalletTransactionDTO = {
  id: string;
  type: string;
  amountPaise: number;
  availableDeltaPaise: number;
  reservedDeltaPaise: number;
  availableBeforePaise: number;
  availableAfterPaise: number;
  reservedBeforePaise: number;
  reservedAfterPaise: number;
  referenceType: string | null;
  reason: string | null;
  paymentReference: string | null;
  actorAdminId: string | null;
  createdAt: string;
};

export function toAdminWalletTransactionDTO(row: WalletTransactionRow): AdminWalletTransactionDTO {
  return {
    id: row._id.toString(),
    type: row.type,
    amountPaise: row.amountPaise,
    availableDeltaPaise: row.availableDeltaPaise,
    reservedDeltaPaise: row.reservedDeltaPaise,
    availableBeforePaise: row.availableBeforePaise,
    availableAfterPaise: row.availableAfterPaise,
    reservedBeforePaise: row.reservedBeforePaise,
    reservedAfterPaise: row.reservedAfterPaise,
    referenceType: row.referenceType ?? null,
    reason: row.adminReason ?? null,
    paymentReference: row.adminPaymentReference ?? null,
    actorAdminId: row.createdByAdminId ? row.createdByAdminId.toString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type AdminWalletTransactionsPage = {
  transactions: AdminWalletTransactionDTO[];
  nextCursor: string | null;
};

export async function listPlayerWalletTransactionsForAdmin(
  playerId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<AdminWalletTransactionsPage> {
  const player = await resolvePlayer(playerId);
  const limit = clampWalletTransactionsLimit(options.limit);

  const filter: QueryFilter<WalletTransactionRow> = { userId: player._id };
  if (options.cursor) {
    const cursor = decodeWalletCursor(options.cursor);
    const at = new Date(cursor.t);
    filter.$or = [
      { createdAt: { $lt: at } },
      { createdAt: at, _id: { $lt: new Types.ObjectId(cursor.id) } },
    ];
  }

  const rows = await WalletTransaction.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<WalletTransactionRow[]>();

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeWalletCursor(last.createdAt, last._id) : null;

  return { transactions: page.map(toAdminWalletTransactionDTO), nextCursor };
}
