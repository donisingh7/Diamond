import "server-only";
import { Types, type ClientSession, type QueryFilter } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import {
  createPlayerWallet,
  finalizeReservedInSession,
  getWalletView,
  isDuplicateKeyError,
  releaseReservedInSession,
  reserveInSession,
  type WalletView,
} from "@/modules/wallet/services/wallet.service";
import { Withdrawal, type WithdrawalDoc, type WithdrawalRow } from "../models/withdrawal.model";
import {
  buildDestinationSummary,
  toPaymentDetails,
  type CreateWithdrawalRequest,
} from "../validators/withdrawal-input";

/**
 * Player withdrawal lifecycle — request, own list / detail, player cancellation — plus the
 * transaction-scoped ADMIN approve / reject primitives Window 6A will route (NOT exposed here).
 *
 * Every state transition is one MongoDB transaction that also moves the wallet and appends the
 * matching immutable `walletTransactions` row — there is no "withdrawal changed but wallet
 * didn't" (or vice-versa) state. The wallet is touched ONLY through the Window 4A2
 * reserve / release / finalize primitives (`reserveInSession` etc.); this service never writes a
 * balance directly (CODEX_RULES #10).
 *
 *  - request : `available -= X`, `reserved += X`, `WITHDRAWAL_RESERVED`, Withdrawal → PENDING
 *  - cancel  : `available += X`, `reserved -= X`, `WITHDRAWAL_RELEASED`, PENDING → CANCELLED
 *  - reject  : `available += X`, `reserved -= X`, `WITHDRAWAL_RELEASED`, PENDING → REJECTED  (admin)
 *  - approve : `reserved -= X` only,             `WITHDRAWAL_APPROVED`, PENDING → APPROVED  (admin)
 *
 * A withdrawal has ONE terminal transition (CAS filters on `status: "PENDING"`), so cancel and
 * reject can safely share the `WITHDRAWAL_RELEASED:<id>` ledger key — only one can ever win.
 * No real bank/UPI payout happens anywhere in the prototype.
 */

export const WITHDRAWAL_MINIMUM_PAISE = 100;
export const WITHDRAWAL_REFERENCE_TYPE = "WITHDRAWAL";
export const WITHDRAWAL_LIST_DEFAULT_LIMIT = 20;
export const WITHDRAWAL_LIST_MAX_LIMIT = 50;

const HEX24 = /^[a-f0-9]{24}$/i;
const NOT_PENDING_MESSAGE = "This withdrawal is not pending and cannot be changed.";

export type WithdrawalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type WithdrawalMethod = "BANK" | "UPI";

/** Deterministic ledger idempotency keys, tied to the withdrawal id + transition class. */
export function withdrawalReserveKey(id: Types.ObjectId): string {
  return `WITHDRAWAL_RESERVED:${id.toHexString()}`;
}
export function withdrawalReleaseKey(id: Types.ObjectId): string {
  return `WITHDRAWAL_RELEASED:${id.toHexString()}`;
}
export function withdrawalApproveKey(id: Types.ObjectId): string {
  return `WITHDRAWAL_APPROVED:${id.toHexString()}`;
}

/** ₹1 minimum, whole paise within safe-integer precision. The maximum is the live available
 *  wallet balance and is enforced by the reserve primitive, not here. */
export function assertWithdrawalAmount(amountPaise: number): number {
  if (!Number.isSafeInteger(amountPaise)) {
    throw new DomainError("MONEY_OUT_OF_RANGE", "Withdrawal amount must be a whole number of paise within supported precision.");
  }
  if (amountPaise < WITHDRAWAL_MINIMUM_PAISE) {
    throw new DomainError("INVALID_AMOUNT", `Minimum withdrawal is ${WITHDRAWAL_MINIMUM_PAISE} paise (₹1).`);
  }
  return amountPaise;
}

// --- DTO ------------------------------------------------------------------------------------

export type WithdrawalDestinationDTO = { method: WithdrawalMethod; summary: string };

/**
 * Player-safe view. NEVER exposes `userId`, `paymentDetails` (raw account / UPI id), the ledger
 * idempotency key, `decidedByAdminId`, `clientRequestId` or any Mongo sub-document `_id`. The
 * schema stores a single generic `decidedAt`; the DTO maps it onto the status-specific
 * `cancelledAt` / `approvedAt` / `rejectedAt` while also returning it raw.
 */
export type WithdrawalDTO = {
  id: string;
  method: WithdrawalMethod;
  amountPaise: number;
  status: WithdrawalStatus;
  destination: WithdrawalDestinationDTO;
  rejectionReason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  cancelledAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type WithdrawalDTOSource = Pick<
  WithdrawalRow,
  "method" | "amountPaise" | "status" | "destinationSummary" | "rejectionReason" | "requestedAt" | "decidedAt" | "createdAt" | "updatedAt"
> & { _id: Types.ObjectId };

export function toWithdrawalDTO(row: WithdrawalDTOSource): WithdrawalDTO {
  const { status, method } = row;
  const decidedAtIso = row.decidedAt ? row.decidedAt.toISOString() : null;
  return {
    id: row._id.toString(),
    method,
    amountPaise: row.amountPaise,
    status,
    destination: { method, summary: row.destinationSummary },
    rejectionReason: status === "REJECTED" ? row.rejectionReason ?? null : null,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: decidedAtIso,
    cancelledAt: status === "CANCELLED" ? decidedAtIso : null,
    approvedAt: status === "APPROVED" ? decidedAtIso : null,
    rejectedAt: status === "REJECTED" ? decidedAtIso : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type WithdrawalReceipt = { withdrawal: WithdrawalDTO; wallet: WalletView; serverNow: string };

// --- cursor (opaque base64url over the last row's (createdAt, _id)) ------------------------

type DecodedCursor = { t: number; id: string };

export function encodeWithdrawalCursor(createdAt: Date, id: Types.ObjectId): string {
  return Buffer.from(JSON.stringify({ t: createdAt.getTime(), id: id.toHexString() })).toString("base64url");
}

export function decodeWithdrawalCursor(raw: string): DecodedCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" || parsed === null
      || typeof (parsed as DecodedCursor).t !== "number"
      || !Number.isFinite((parsed as DecodedCursor).t)
      || typeof (parsed as DecodedCursor).id !== "string"
      || !HEX24.test((parsed as DecodedCursor).id)
    ) {
      throw new Error("malformed cursor");
    }
    return { t: (parsed as DecodedCursor).t, id: (parsed as DecodedCursor).id };
  } catch {
    throw new DomainError("INVALID_INPUT", "Invalid pagination cursor.");
  }
}

export function clampWithdrawalListLimit(limit: number | undefined): number {
  if (limit === undefined) return WITHDRAWAL_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), WITHDRAWAL_LIST_MAX_LIMIT);
}

// --- reads ---------------------------------------------------------------------------------

export type PlayerWithdrawalsPage = {
  withdrawals: WithdrawalDTO[];
  nextCursor: string | null;
};

export type ListPlayerWithdrawalsOptions = {
  limit?: number;
  cursor?: string;
  status?: WithdrawalStatus;
};

/**
 * The caller's own withdrawals, newest first, ALWAYS bounded (`limit` 1–50, default 20). Stable
 * order is `createdAt` desc then `_id` desc; the cursor carries the last row's `(createdAt, _id)`
 * so paging never skips or repeats a row even when timestamps collide.
 */
export async function listPlayerWithdrawals(
  userId: Types.ObjectId,
  options: ListPlayerWithdrawalsOptions = {},
): Promise<PlayerWithdrawalsPage> {
  const limit = clampWithdrawalListLimit(options.limit);

  const filter: QueryFilter<WithdrawalRow> = { userId };
  if (options.status) filter.status = options.status;
  if (options.cursor) {
    const cursor = decodeWithdrawalCursor(options.cursor);
    const at = new Date(cursor.t);
    filter.$or = [
      { createdAt: { $lt: at } },
      { createdAt: at, _id: { $lt: new Types.ObjectId(cursor.id) } },
    ];
  }

  const rows = await Withdrawal.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<WithdrawalRow[]>();

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeWithdrawalCursor(last.createdAt, last._id) : null;

  return { withdrawals: page.map(toWithdrawalDTO), nextCursor };
}

/**
 * One of the caller's own withdrawals by its 24-hex `id` handle. A missing OR non-owned
 * withdrawal is an indistinguishable `WITHDRAWAL_NOT_FOUND` (404) — knowing an id never
 * confirms another player's withdrawal exists.
 */
export async function getPlayerWithdrawalDetail(userId: Types.ObjectId, id: string): Promise<WithdrawalDTO> {
  const trimmed = id.trim();
  if (!HEX24.test(trimmed)) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  const row = await Withdrawal.findOne({ _id: new Types.ObjectId(trimmed), userId }).lean<WithdrawalRow>();
  if (!row) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  return toWithdrawalDTO(row);
}

/** Hydrated owned withdrawal (for the mutation services). Same `WITHDRAWAL_NOT_FOUND` contract. */
export async function resolveOwnedWithdrawal(
  userId: Types.ObjectId,
  id: string,
  session?: ClientSession,
): Promise<WithdrawalDoc> {
  const trimmed = id.trim();
  if (!HEX24.test(trimmed)) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  const query = Withdrawal.findOne({ _id: new Types.ObjectId(trimmed), userId });
  if (session) query.session(session);
  const doc = await query;
  if (!doc) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  return doc;
}

async function receiptFor(withdrawalId: Types.ObjectId, userId: Types.ObjectId, now: Date): Promise<WithdrawalReceipt> {
  const row = await Withdrawal.findOne({ _id: withdrawalId, userId }).lean<WithdrawalRow>();
  if (!row) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  return { withdrawal: toWithdrawalDTO(row), wallet: await getWalletView(userId), serverNow: now.toISOString() };
}

// --- request ------------------------------------------------------------------------------

export type RequestWithdrawalInput = {
  userId: Types.ObjectId;
  /** Already parsed by `createWithdrawalSchema`. */
  request: CreateWithdrawalRequest;
};

/** Test seams — production passes neither. */
export type WithdrawalMutationOptions = {
  /** Authoritative time source. */
  clock?: () => Date;
  /** Invoked inside the transaction right after the wallet movement, to force a rollback. */
  afterWalletMovement?: () => void;
};

type RequestFingerprint = { method: WithdrawalMethod; amountPaise: number; destinationSummary: string };

function assertSameLogicalRequest(
  existing: Pick<WithdrawalRow, "method" | "amountPaise" | "destinationSummary">,
  fingerprint: RequestFingerprint,
): void {
  if (
    existing.method !== fingerprint.method
    || existing.amountPaise !== fingerprint.amountPaise
    || existing.destinationSummary !== fingerprint.destinationSummary
  ) {
    throw new DomainError("DUPLICATE_REQUEST", "This request id was already used for a different withdrawal.");
  }
}

/**
 * Create a PENDING withdrawal for `amountPaise`, atomically moving the wallet from available to
 * reserved and appending one `WITHDRAWAL_RESERVED` ledger row.
 *
 *  1. validate the amount (`INVALID_AMOUNT` below ₹1, `MONEY_OUT_OF_RANGE` beyond precision)
 *  2. **existing-success idempotency recovery first** — a retry with the same
 *     `(userId, clientRequestId)` and the same logical request (method + amount + destination)
 *     returns the ORIGINAL withdrawal with no second reserve / ledger row; a conflicting payload
 *     is `DUPLICATE_REQUEST`
 *  3. ensure a ₹0 wallet exists (never grants funds), pre-allocate the withdrawal `_id`,
 *     validate the document shape
 *  4. one transaction: `reserveInSession` (`INSUFFICIENT_BALANCE` when available < amount — this
 *     is the "maximum = available balance" rule) → native `insertOne` of the PENDING withdrawal.
 *     Reserve precedes the insert so an insert failure demonstrably rolls the wallet back.
 *  5. a lost `(userId, clientRequestId)` race collides on the unique index inside the aborted
 *     transaction; recover the winner outside it.
 */
export async function requestWithdrawal(
  input: RequestWithdrawalInput,
  options: WithdrawalMutationOptions = {},
): Promise<WithdrawalReceipt> {
  const clock = options.clock ?? (() => new Date());
  const { userId, request } = input;

  const amountPaise = assertWithdrawalAmount(request.amountPaise);
  const method = request.method;
  const destinationSummary = buildDestinationSummary(request);
  const paymentDetails = toPaymentDetails(request);
  const fingerprint: RequestFingerprint = { method, amountPaise, destinationSummary };

  const existing = await Withdrawal.findOne({ userId, clientRequestId: request.clientRequestId }).lean<WithdrawalRow>();
  if (existing) {
    assertSameLogicalRequest(existing, fingerprint);
    return { withdrawal: toWithdrawalDTO(existing), wallet: await getWalletView(userId), serverNow: clock().toISOString() };
  }

  // A fund-less player has no wallet yet; make one at ₹0 so the reserve fails INSUFFICIENT_BALANCE
  // (a real domain answer) rather than WALLET_NOT_FOUND.
  await createPlayerWallet(userId);

  const withdrawalId = new Types.ObjectId();
  const draft = new Withdrawal({
    _id: withdrawalId,
    userId,
    clientRequestId: request.clientRequestId,
    amountPaise,
    method,
    paymentDetails,
    destinationSummary,
    status: "PENDING",
    requestedAt: clock(),
  });
  await draft.validate();

  try {
    const at = await withTransaction(async (session) => {
      const now = clock();
      await reserveInSession(
        {
          userId,
          amountPaise,
          idempotencyKey: withdrawalReserveKey(withdrawalId),
          referenceType: WITHDRAWAL_REFERENCE_TYPE,
          referenceId: withdrawalId,
        },
        session,
      );
      options.afterWalletMovement?.();

      // Native insert (mirrors bet placement): a Mongoose document created inside
      // `connection.transaction()` is reset on retry, and resetting its `strict:"throw"`
      // `paymentDetails` sub-document throws. The unique `(userId, clientRequestId)` index is
      // the real backstop; the draft above was already `.validate()`d.
      const obj = draft.toObject();
      obj.requestedAt = now;
      await Withdrawal.collection.insertOne({ ...obj, createdAt: now, updatedAt: now }, { session });
      return now;
    });

    return receiptFor(withdrawalId, userId, at);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const raced = await Withdrawal.findOne({ userId, clientRequestId: request.clientRequestId }).lean<WithdrawalRow>();
      if (raced) {
        assertSameLogicalRequest(raced, fingerprint);
        return { withdrawal: toWithdrawalDTO(raced), wallet: await getWalletView(userId), serverNow: clock().toISOString() };
      }
    }
    throw error;
  }
}

// --- terminal transitions (cancel / reject / approve) -------------------------------------

type WalletMove = (
  session: ClientSession,
  ctx: { userId: Types.ObjectId; amountPaise: number; withdrawalId: Types.ObjectId },
) => Promise<unknown>;

type TerminalTransition = {
  withdrawalId: Types.ObjectId;
  userId: Types.ObjectId;
  amountPaise: number;
  to: Exclude<WithdrawalStatus, "PENDING">;
  walletMove: WalletMove;
  /** decidedByAdminId / rejectionReason — merged into the `$set`. */
  extraSet?: Record<string, unknown>;
  clock: () => Date;
  afterWalletMovement?: () => void;
};

/**
 * The atomic core every terminal transition shares: one transaction that re-reads the
 * withdrawal in-session, moves the wallet through a Window 4A2 primitive, then flips the status
 * with a compare-and-set on `status: "PENDING"`. `matchedCount !== 1` (a concurrent transition
 * already won) aborts the whole transaction — the wallet movement rolls back with it. An
 * in-session read that already shows the target status means an identical racing transition
 * committed first: return without moving money again.
 */
async function applyTerminalTransition(t: TerminalTransition): Promise<Date> {
  return withTransaction(async (session) => {
    const now = t.clock();
    const fresh = await Withdrawal.findOne({ _id: t.withdrawalId }).session(session);
    if (!fresh) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
    if (fresh.status === t.to) return now;
    if (fresh.status !== "PENDING") throw new DomainError("WITHDRAWAL_NOT_PENDING", NOT_PENDING_MESSAGE);

    await t.walletMove(session, { userId: t.userId, amountPaise: t.amountPaise, withdrawalId: t.withdrawalId });
    t.afterWalletMovement?.();

    const res = await Withdrawal.collection.updateOne(
      { _id: t.withdrawalId, status: "PENDING" },
      { $set: { status: t.to, decidedAt: now, updatedAt: now, ...t.extraSet } },
      { session },
    );
    if (res.matchedCount !== 1) throw new DomainError("WITHDRAWAL_NOT_PENDING", NOT_PENDING_MESSAGE);
    return now;
  });
}

export type CancelWithdrawalInput = {
  userId: Types.ObjectId;
  /** The withdrawal's 24-hex `id` handle. */
  withdrawalId: string;
};

/**
 * Player-cancels their own PENDING withdrawal: `PENDING → CANCELLED`, `available += amount`,
 * `reserved -= amount`, one `WITHDRAWAL_RELEASED` ledger row — all atomic. Safe to retry: an
 * already-CANCELLED withdrawal returns its DTO with NO second release; an APPROVED / REJECTED
 * one fails `WITHDRAWAL_NOT_PENDING` (409) deterministically. Two concurrent cancels release the
 * reserved funds exactly once and both callers get the cancelled receipt.
 */
export async function cancelWithdrawal(
  input: CancelWithdrawalInput,
  options: WithdrawalMutationOptions = {},
): Promise<WithdrawalReceipt> {
  const clock = options.clock ?? (() => new Date());
  const { userId } = input;
  const current = await resolveOwnedWithdrawal(userId, input.withdrawalId);
  const withdrawalId = current._id;

  if (current.status === "CANCELLED") return receiptFor(withdrawalId, userId, clock());
  if (current.status !== "PENDING") {
    throw new DomainError("WITHDRAWAL_NOT_PENDING", NOT_PENDING_MESSAGE);
  }

  try {
    const at = await applyTerminalTransition({
      withdrawalId,
      userId,
      amountPaise: current.amountPaise,
      to: "CANCELLED",
      clock,
      afterWalletMovement: options.afterWalletMovement,
      walletMove: (session, ctx) =>
        releaseReservedInSession(
          {
            userId: ctx.userId,
            amountPaise: ctx.amountPaise,
            idempotencyKey: withdrawalReleaseKey(ctx.withdrawalId),
            referenceType: WITHDRAWAL_REFERENCE_TYPE,
            referenceId: ctx.withdrawalId,
          },
          session,
        ),
    });
    return receiptFor(withdrawalId, userId, at);
  } catch (error) {
    // A concurrent cancel may have already driven the withdrawal to CANCELLED (unique
    // `WITHDRAWAL_RELEASED:<id>` key E11000, a CAS that matched nothing, or a write-conflict
    // retry that observed the committed result). Recover only when the end state is real —
    // a forced-rollback failure leaves it PENDING and rethrows.
    const settled = await Withdrawal.findOne({ _id: withdrawalId, userId }).lean<WithdrawalRow>();
    if (settled && settled.status === "CANCELLED") {
      return { withdrawal: toWithdrawalDTO(settled), wallet: await getWalletView(userId), serverNow: clock().toISOString() };
    }
    throw error;
  }
}

// --- FUTURE ADMIN primitives — NOT exposed by any route in Window 5A (Window 6A routes these) --

export type AdminApproveWithdrawalInput = {
  withdrawalId: Types.ObjectId;
  adminId: Types.ObjectId;
};
export type AdminRejectWithdrawalInput = AdminApproveWithdrawalInput & { reason: string };

/**
 * ADMIN approve: `PENDING → APPROVED`, `reserved -= amount` (funds "paid out" — no real bank
 * transfer in the prototype), available UNCHANGED, one `WITHDRAWAL_APPROVED` ledger row. CAS on
 * `status: "PENDING"`. Idempotent: an already-APPROVED withdrawal returns its DTO.
 */
export async function approveWithdrawalByAdmin(
  input: AdminApproveWithdrawalInput,
  options: WithdrawalMutationOptions = {},
): Promise<WithdrawalDTO> {
  const clock = options.clock ?? (() => new Date());
  const current = await Withdrawal.findById(input.withdrawalId).lean<WithdrawalRow>();
  if (!current) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  if (current.status === "APPROVED") return toWithdrawalDTO(current);
  if (current.status !== "PENDING") throw new DomainError("WITHDRAWAL_NOT_PENDING", NOT_PENDING_MESSAGE);

  return finishAdminDecision(input.withdrawalId, "APPROVED", () =>
    applyTerminalTransition({
      withdrawalId: current._id,
      userId: current.userId,
      amountPaise: current.amountPaise,
      to: "APPROVED",
      extraSet: { decidedByAdminId: input.adminId },
      clock,
      afterWalletMovement: options.afterWalletMovement,
      walletMove: (session, ctx) =>
        finalizeReservedInSession(
          {
            userId: ctx.userId,
            amountPaise: ctx.amountPaise,
            idempotencyKey: withdrawalApproveKey(ctx.withdrawalId),
            referenceType: WITHDRAWAL_REFERENCE_TYPE,
            referenceId: ctx.withdrawalId,
          },
          session,
        ),
    }),
  );
}

/** Run a terminal admin transition, then return the withdrawal in its `target` state. If the
 *  transition threw but a concurrent decision already reached `target`, recover; otherwise
 *  rethrow (a forced-rollback failure leaves it PENDING). */
async function finishAdminDecision(
  withdrawalId: Types.ObjectId,
  target: "APPROVED" | "REJECTED",
  run: () => Promise<unknown>,
): Promise<WithdrawalDTO> {
  try {
    await run();
  } catch (error) {
    const settled = await Withdrawal.findById(withdrawalId).lean<WithdrawalRow>();
    if (settled && settled.status === target) return toWithdrawalDTO(settled);
    throw error;
  }
  const row = await Withdrawal.findById(withdrawalId).lean<WithdrawalRow>();
  if (!row || row.status !== target) throw new DomainError("WITHDRAWAL_NOT_PENDING", NOT_PENDING_MESSAGE);
  return toWithdrawalDTO(row);
}

/**
 * ADMIN reject: `PENDING → REJECTED` with a stored reason, `available += amount`,
 * `reserved -= amount`, one `WITHDRAWAL_RELEASED` ledger row. CAS on `status: "PENDING"`.
 * Idempotent: an already-REJECTED withdrawal returns its DTO.
 */
export async function rejectWithdrawalByAdmin(
  input: AdminRejectWithdrawalInput,
  options: WithdrawalMutationOptions = {},
): Promise<WithdrawalDTO> {
  const clock = options.clock ?? (() => new Date());
  const reason = input.reason?.trim();
  if (!reason) throw new DomainError("INVALID_INPUT", "A rejection reason is required.");

  const current = await Withdrawal.findById(input.withdrawalId).lean<WithdrawalRow>();
  if (!current) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  if (current.status === "REJECTED") return toWithdrawalDTO(current);
  if (current.status !== "PENDING") throw new DomainError("WITHDRAWAL_NOT_PENDING", NOT_PENDING_MESSAGE);

  return finishAdminDecision(input.withdrawalId, "REJECTED", () =>
    applyTerminalTransition({
      withdrawalId: current._id,
      userId: current.userId,
      amountPaise: current.amountPaise,
      to: "REJECTED",
      extraSet: { decidedByAdminId: input.adminId, rejectionReason: reason },
      clock,
      afterWalletMovement: options.afterWalletMovement,
      walletMove: (session, ctx) =>
        releaseReservedInSession(
          {
            userId: ctx.userId,
            amountPaise: ctx.amountPaise,
            idempotencyKey: withdrawalReleaseKey(ctx.withdrawalId),
            referenceType: WITHDRAWAL_REFERENCE_TYPE,
            referenceId: ctx.withdrawalId,
          },
          session,
        ),
    }),
  );
}
