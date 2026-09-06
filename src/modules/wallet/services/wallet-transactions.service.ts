import "server-only";
import { Types, type QueryFilter } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { WalletTransaction, type WalletTransactionRow } from "../models/wallet-transaction.model";

/**
 * Player ledger read. Append-only history, newest first, ALWAYS bounded — there is no
 * "all history" response (Window 4A2 brief §17). The bound is a technical API safety limit,
 * not a financial product maximum.
 */

export const WALLET_TRANSACTIONS_DEFAULT_LIMIT = 20;
export const WALLET_TRANSACTIONS_MAX_LIMIT = 100;

/** Player-safe projection: internal admin/security fields (`idempotencyKey`, `createdByAdminId`,
 *  `walletId`, `userId`) are never exposed. `referenceType` is a coarse, non-identifying tag. */
export type WalletTransactionDTO = {
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
  createdAt: string;
};

type WalletTransactionShape = {
  _id: Types.ObjectId;
  type: string;
  amountPaise: number;
  availableDeltaPaise: number;
  reservedDeltaPaise: number;
  availableBeforePaise: number;
  availableAfterPaise: number;
  reservedBeforePaise: number;
  reservedAfterPaise: number;
  referenceType?: string | null;
  createdAt: Date;
};

export function toWalletTransactionDTO(row: WalletTransactionShape): WalletTransactionDTO {
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
    createdAt: row.createdAt.toISOString(),
  };
}

type DecodedCursor = { t: number; id: string };

export function encodeWalletCursor(createdAt: Date, id: Types.ObjectId): string {
  return Buffer.from(JSON.stringify({ t: createdAt.getTime(), id: id.toHexString() })).toString("base64url");
}

export function decodeWalletCursor(raw: string): DecodedCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" || parsed === null
      || typeof (parsed as DecodedCursor).t !== "number"
      || !Number.isFinite((parsed as DecodedCursor).t)
      || typeof (parsed as DecodedCursor).id !== "string"
      || !/^[a-f0-9]{24}$/i.test((parsed as DecodedCursor).id)
    ) {
      throw new Error("malformed cursor");
    }
    return { t: (parsed as DecodedCursor).t, id: (parsed as DecodedCursor).id };
  } catch {
    throw new DomainError("INVALID_INPUT", "Invalid pagination cursor.");
  }
}

export function clampWalletTransactionsLimit(limit: number | undefined): number {
  if (limit === undefined) return WALLET_TRANSACTIONS_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), WALLET_TRANSACTIONS_MAX_LIMIT);
}

export type WalletTransactionsPage = {
  transactions: WalletTransactionDTO[];
  /** Opaque cursor for the next (older) page, or `null` when the last page has been returned. */
  nextCursor: string | null;
};

/**
 * Own ledger only — `userId` comes from the authenticated session, never the client. Stable
 * order is `createdAt` desc then `_id` desc; the cursor carries the last row's `(createdAt, _id)`
 * so paging never skips or repeats a row even when timestamps collide.
 */
export async function listWalletTransactions(
  userId: Types.ObjectId,
  options: { limit?: number; cursor?: string } = {},
): Promise<WalletTransactionsPage> {
  const limit = clampWalletTransactionsLimit(options.limit);

  const filter: QueryFilter<WalletTransactionRow> = { userId };
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

  return { transactions: page.map(toWalletTransactionDTO), nextCursor };
}
