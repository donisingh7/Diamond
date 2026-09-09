import "server-only";
import type { ClientSession, QueryFilter, Types } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { safeAdd } from "@/lib/money";
import { Wallet, type WalletDoc, type WalletRecord } from "../models/wallet.model";
import {
  WalletTransaction,
  type WalletTransactionDoc,
  type WalletTransactionType,
} from "../models/wallet-transaction.model";

/**
 * The wallet domain service is the ONLY code that mutates `wallets` balances, and every
 * mutation it performs also writes the matching immutable `walletTransactions` row inside the
 * SAME MongoDB transaction. Nothing else — no route handler, no other service — may touch a
 * balance directly (CODEX_RULES #10).
 *
 * Two layers:
 *  - `applyWalletMovement(input, session)` — the transaction-scoped primitive. It runs inside a
 *    `ClientSession` that a HIGHER-LEVEL service owns (future bet placement / edit / withdrawal /
 *    settlement / admin adjustment), so those callers can make `Bet.create` + wallet debit +
 *    ledger atomic in one transaction. It never opens its own transaction.
 *  - the named `*InSession` wrappers — ergonomic, type-narrowed entry points for the five
 *    conceptual operations (credit / debit available, reserve, release, finalize reserved).
 *
 * Standalone operations that are not part of a larger write (Mock Deposit today) wrap the
 * primitive in their own `withTransaction(...)` — see `mock-deposit.service.ts`.
 */

export type { WalletTransactionType } from "../models/wallet-transaction.model";

/** Movement types that add to `availableBalancePaise`. */
export type AvailableCreditType = Extract<
  WalletTransactionType,
  "MOCK_DEPOSIT" | "BET_EDIT_REFUND" | "WIN_CREDIT" | "ADMIN_CREDIT" | "DEPOSIT_CREDIT"
>;
/** Movement types that subtract from `availableBalancePaise`. */
export type AvailableDebitType = Extract<
  WalletTransactionType,
  "BET_PLACED" | "BET_EDIT_DEBIT" | "ADMIN_DEBIT"
>;

export type BalanceDelta = { availableDeltaPaise: number; reservedDeltaPaise: number };

/**
 * FROZEN type → balance-movement table (DOMAIN_RULES.md "WALLET TRANSACTION TYPES", Window 4A2
 * brief §7). The service DERIVES the deltas from `(type, amountPaise)` and never accepts them
 * from a caller, so an impossible delta can never be paired with a type. This mirrors the
 * `walletTransactions` model's own `pre("validate")` reconciliation exactly — the model is the
 * final backstop, this is the single authoring point.
 */
export function movementDeltas(type: WalletTransactionType, amountPaise: number): BalanceDelta {
  switch (type) {
    case "MOCK_DEPOSIT":
    case "BET_EDIT_REFUND":
    case "WIN_CREDIT":
    case "ADMIN_CREDIT":
    case "DEPOSIT_CREDIT":
      return { availableDeltaPaise: amountPaise, reservedDeltaPaise: 0 };
    case "BET_PLACED":
    case "BET_EDIT_DEBIT":
    case "ADMIN_DEBIT":
      return { availableDeltaPaise: -amountPaise, reservedDeltaPaise: 0 };
    case "WITHDRAWAL_RESERVED":
      return { availableDeltaPaise: -amountPaise, reservedDeltaPaise: amountPaise };
    case "WITHDRAWAL_RELEASED":
      return { availableDeltaPaise: amountPaise, reservedDeltaPaise: -amountPaise };
    case "WITHDRAWAL_APPROVED":
      return { availableDeltaPaise: 0, reservedDeltaPaise: -amountPaise };
    default: {
      const exhaustive: never = type;
      throw new DomainError("INTERNAL_ERROR", `Unknown wallet movement type: ${String(exhaustive)}`);
    }
  }
}

/** Movement amounts are whole paise, at least 1, within safe-integer precision. */
export function assertMovementAmount(amountPaise: number): number {
  if (!Number.isSafeInteger(amountPaise)) {
    throw new DomainError("MONEY_OUT_OF_RANGE", "Amount must be a whole number of paise within supported precision.");
  }
  if (amountPaise < 1) {
    throw new DomainError("INVALID_AMOUNT", "Amount must be at least 1 paise.");
  }
  return amountPaise;
}

export function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; cause?: { code?: unknown }; message?: unknown };
  return e.code === 11000 || e.cause?.code === 11000
    || (typeof e.message === "string" && e.message.includes("E11000"));
}

/**
 * Idempotent zero-value wallet creation. Admin "create player" (a later window) calls this
 * inside its own transaction; the player wallet read APIs call it opportunistically so a
 * player always has a wallet regardless of creation order. It NEVER grants funds — a new
 * wallet is `available = 0, reserved = 0`, and any real balance arrives only through a
 * ledgered movement. The unique `userId` index guarantees one wallet per user; a lost create
 * race is recovered by re-reading the winner.
 */
export async function createPlayerWallet(userId: Types.ObjectId, session?: ClientSession): Promise<WalletDoc> {
  try {
    const wallet = await Wallet.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, currency: "INR", availableBalancePaise: 0, reservedBalancePaise: 0 } },
      { upsert: true, returnDocument: "after", ...(session ? { session } : {}) },
    );
    return wallet as WalletDoc;
  } catch (error) {
    if (isDuplicateKeyError(error)) return getWalletDoc(userId, session);
    throw error;
  }
}

export async function getWalletDoc(userId: Types.ObjectId, session?: ClientSession): Promise<WalletDoc> {
  const query = Wallet.findOne({ userId });
  if (session) query.session(session);
  const wallet = await query;
  if (!wallet) throw new DomainError("WALLET_NOT_FOUND", "Wallet not found.");
  return wallet;
}

export type WalletView = {
  currency: string;
  availableBalancePaise: number;
  reservedBalancePaise: number;
  /** Derived, never persisted: `available + reserved`. */
  totalBalancePaise: number;
};

export function toWalletView(
  wallet: Pick<WalletRecord, "currency" | "availableBalancePaise" | "reservedBalancePaise">,
): WalletView {
  return {
    currency: wallet.currency,
    availableBalancePaise: wallet.availableBalancePaise,
    reservedBalancePaise: wallet.reservedBalancePaise,
    totalBalancePaise: safeAdd(wallet.availableBalancePaise, wallet.reservedBalancePaise),
  };
}

/** Player wallet read: ensures a `₹0` wallet exists (never grants funds), then projects the view. */
export async function getWalletView(userId: Types.ObjectId): Promise<WalletView> {
  const wallet = await createPlayerWallet(userId);
  return toWalletView(wallet);
}

export function getTransactionByIdempotencyKey(
  idempotencyKey: string,
  session?: ClientSession,
): Promise<WalletTransactionDoc | null> {
  const query = WalletTransaction.findOne({ idempotencyKey });
  if (session) query.session(session);
  return query.exec();
}

export type WalletMovementInput = {
  userId: Types.ObjectId;
  type: WalletTransactionType;
  amountPaise: number;
  /** Deterministic, globally unique. Same key + same logical op = safe replay; same key +
   *  different `type`/`amountPaise`/`userId` = `DUPLICATE_REQUEST`. e.g. `BET_PLACED:<betId>`. */
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: Types.ObjectId;
  actorAdminId?: Types.ObjectId;
  /** Persisted verbatim on the ledger row; meaningful only for ADMIN_CREDIT / ADMIN_DEBIT
   *  (Window 6A1 manual money movement). `assertSameOperation` also compares these so a
   *  replayed idempotency key with a materially different reason/reference is `DUPLICATE_REQUEST`. */
  adminReason?: string;
  adminPaymentReference?: string;
};

export type WalletMovementResult = {
  transactionId: Types.ObjectId;
  type: WalletTransactionType;
  amountPaise: number;
  /** Post-movement balances. */
  availableBalancePaise: number;
  reservedBalancePaise: number;
  /** `true` when this call recovered an already-applied movement instead of moving money again. */
  idempotentReplay: boolean;
};

function assertSameOperation(existing: WalletTransactionDoc, input: WalletMovementInput): void {
  const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") === (b ?? "");
  if (
    existing.type !== input.type
    || existing.amountPaise !== input.amountPaise
    || !existing.userId.equals(input.userId)
    || !sameText(existing.adminReason, input.adminReason)
    || !sameText(existing.adminPaymentReference, input.adminPaymentReference)
  ) {
    throw new DomainError(
      "DUPLICATE_REQUEST",
      "This idempotency key was already used for a different wallet operation.",
    );
  }
}

/**
 * Transaction-scoped balance movement. MUST be called with a `ClientSession` owned by the
 * caller; the wallet `$inc` and the `walletTransactions` insert commit or roll back together
 * with everything else the caller wrote in that transaction.
 *
 * Concurrency: the balance change is a single conditional `findOneAndUpdate` — a debit filters
 * on `availableBalancePaise >= amount` (and reserved debits on `reservedBalancePaise >= amount`)
 * so two racing debits cannot both succeed. Under `readConcern: "snapshot"` the loser hits a
 * write conflict, the `withTransaction` wrapper retries the callback, and the retry re-reads
 * the now-lower balance and fails `INSUFFICIENT_BALANCE`. Balances can never go negative.
 *
 * Idempotency: an already-committed movement with this key is detected and returned without a
 * second mutation. A concurrent, not-yet-committed duplicate instead collides on the unique
 * `idempotencyKey` index at insert time (E11000) — the standalone caller catches that OUTSIDE
 * the aborted transaction and recovers the original result.
 */
export async function applyWalletMovement(
  input: WalletMovementInput,
  session: ClientSession,
): Promise<WalletMovementResult> {
  const { userId, type, amountPaise, idempotencyKey } = input;
  assertMovementAmount(amountPaise);
  const { availableDeltaPaise, reservedDeltaPaise } = movementDeltas(type, amountPaise);

  const existing = await getTransactionByIdempotencyKey(idempotencyKey, session);
  if (existing) {
    assertSameOperation(existing, input);
    const wallet = await getWalletDoc(userId, session);
    return {
      transactionId: existing._id,
      type,
      amountPaise,
      availableBalancePaise: wallet.availableBalancePaise,
      reservedBalancePaise: wallet.reservedBalancePaise,
      idempotentReplay: true,
    };
  }

  const guard: QueryFilter<WalletRecord> = { userId };
  if (availableDeltaPaise < 0) guard.availableBalancePaise = { $gte: -availableDeltaPaise };
  if (reservedDeltaPaise < 0) guard.reservedBalancePaise = { $gte: -reservedDeltaPaise };

  const updated = await Wallet.findOneAndUpdate(
    guard,
    { $inc: { availableBalancePaise: availableDeltaPaise, reservedBalancePaise: reservedDeltaPaise } },
    { returnDocument: "after", session },
  );
  if (!updated) {
    const walletExists = await Wallet.exists({ userId }).session(session);
    throw walletExists
      ? new DomainError("INSUFFICIENT_BALANCE", "Wallet balance is insufficient for this operation.")
      : new DomainError("WALLET_NOT_FOUND", "Wallet not found.");
  }

  const availableAfterPaise = updated.availableBalancePaise;
  const reservedAfterPaise = updated.reservedBalancePaise;
  const [ledger] = await WalletTransaction.create(
    [
      {
        userId,
        walletId: updated._id,
        type,
        amountPaise,
        availableDeltaPaise,
        reservedDeltaPaise,
        availableBeforePaise: safeAdd(availableAfterPaise, -availableDeltaPaise),
        availableAfterPaise,
        reservedBeforePaise: safeAdd(reservedAfterPaise, -reservedDeltaPaise),
        reservedAfterPaise,
        idempotencyKey,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdByAdminId: input.actorAdminId,
        adminReason: input.adminReason,
        adminPaymentReference: input.adminPaymentReference,
      },
    ],
    { session },
  );

  return {
    transactionId: ledger._id,
    type,
    amountPaise,
    availableBalancePaise: availableAfterPaise,
    reservedBalancePaise: reservedAfterPaise,
    idempotentReplay: false,
  };
}

type NamedMovementInput<T extends WalletTransactionType> = {
  userId: Types.ObjectId;
  type: T;
  amountPaise: number;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: Types.ObjectId;
  actorAdminId?: Types.ObjectId;
  adminReason?: string;
  adminPaymentReference?: string;
};

type ReservedMovementInput = {
  userId: Types.ObjectId;
  amountPaise: number;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: Types.ObjectId;
};

/** available += amount. `type` ∈ MOCK_DEPOSIT | BET_EDIT_REFUND | WIN_CREDIT | ADMIN_CREDIT. */
export function creditAvailableInSession(
  input: NamedMovementInput<AvailableCreditType>,
  session: ClientSession,
): Promise<WalletMovementResult> {
  return applyWalletMovement(input, session);
}

/** available -= amount (fails `INSUFFICIENT_BALANCE` below it). `type` ∈ BET_PLACED | BET_EDIT_DEBIT | ADMIN_DEBIT. */
export function debitAvailableInSession(
  input: NamedMovementInput<AvailableDebitType>,
  session: ClientSession,
): Promise<WalletMovementResult> {
  return applyWalletMovement(input, session);
}

/** available -= amount, reserved += amount (withdrawal request — no Withdrawal document here). */
export function reserveInSession(
  input: ReservedMovementInput,
  session: ClientSession,
): Promise<WalletMovementResult> {
  return applyWalletMovement({ ...input, type: "WITHDRAWAL_RESERVED" }, session);
}

/** available += amount, reserved -= amount (withdrawal cancel / reject — returns funds). */
export function releaseReservedInSession(
  input: ReservedMovementInput,
  session: ClientSession,
): Promise<WalletMovementResult> {
  return applyWalletMovement({ ...input, type: "WITHDRAWAL_RELEASED" }, session);
}

/** reserved -= amount, available unchanged (withdrawal approve — reserved funds paid out). */
export function finalizeReservedInSession(
  input: ReservedMovementInput,
  session: ClientSession,
): Promise<WalletMovementResult> {
  return applyWalletMovement({ ...input, type: "WITHDRAWAL_APPROVED" }, session);
}
