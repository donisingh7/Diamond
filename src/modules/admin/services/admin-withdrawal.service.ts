import "server-only";
import { Types, type QueryFilter } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { User } from "@/modules/users/models/user.model";
import { normalizeLoginId } from "@/modules/users/validators/identity";
import { getWalletView, isDuplicateKeyError, type WalletView } from "@/modules/wallet/services/wallet.service";
import { writeAuditLog } from "@/modules/audit/services/audit-log.service";
import {
  Withdrawal,
  type WithdrawalRow,
} from "@/modules/withdrawals/models/withdrawal.model";
import {
  approveWithdrawalByAdmin,
  rejectWithdrawalByAdmin,
  type WithdrawalMethod,
  type WithdrawalMutationOptions,
  type WithdrawalStatus,
} from "@/modules/withdrawals/services/withdrawal.service";
import { clampLimit, decodeCursor, encodeCursor, olderThan } from "./pagination";

/**
 * Admin withdrawal operations (Window 6A2) — the money-OUT counterpart to 6A1's money-IN. The
 * LOCKED V1 flow is entirely manual: the player requests a withdrawal (Window 5A already moved
 * `available → reserved`, status PENDING); the admin transfers the money OUTSIDE Diamond; only
 * AFTER the real payment does the admin run **Mark Paid & Approve**, which finalizes the
 * reserved amount (`reserved -= X`, available UNCHANGED — no second debit) and writes an
 * immutable `WITHDRAWAL_APPROVED` ledger row + a `WITHDRAWAL_APPROVED` audit row. Reject
 * releases the reserved amount back to available and writes `WITHDRAWAL_RELEASED` +
 * `WITHDRAWAL_REJECTED` audit.
 *
 * The financial transition itself is the Window 5A `approveWithdrawalByAdmin` /
 * `rejectWithdrawalByAdmin` primitive — NOT duplicated here. This module adds: the required
 * explicit `confirmPaid`, DB-backed idempotency on `(withdrawal, decisionRequestId)`, the
 * in-transaction audit row, and the admin read surface (global list + sensitive detail).
 *
 * Sensitive payout instrument (`paymentDetails` — bank account number / IFSC / UPI id) is
 * returned ONLY by `getWithdrawalDetailForAdmin`. It is never in a list DTO, never in an audit
 * row, never in an error, never logged.
 */

const HEX24 = /^[a-f0-9]{24}$/i;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") === (b ?? "");

export const ADMIN_WITHDRAWAL_LIST_DEFAULT_LIMIT = 25;
export const ADMIN_WITHDRAWAL_LIST_MAX_LIMIT = 100;

// --- DTOs -------------------------------------------------------------------------------

export type AdminWithdrawalPlayer = { id: string; loginId: string; name: string };

/** List row — operational data only, masked destination, NO raw `paymentDetails`. */
export type AdminWithdrawalListItem = {
  id: string;
  player: AdminWithdrawalPlayer;
  method: WithdrawalMethod;
  amountPaise: number;
  status: WithdrawalStatus;
  destinationSummary: string;
  rejectionReason: string | null;
  paymentReference: string | null;
  decidedByAdminId: string | null;
  requestedAt: string;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The BANK / UPI payout instrument — ONLY ever returned from the admin detail endpoint. */
export type AdminPayoutDestination =
  | { method: "BANK"; accountHolderName: string; accountNumber: string; ifsc: string; bankName: string | null }
  | { method: "UPI"; upiId: string };

export type AdminWithdrawalDetail = AdminWithdrawalListItem & {
  decisionNote: string | null;
  /** Enough for the admin to make the real out-of-Diamond transfer. Admin-only, never logged. */
  payoutDestination: AdminPayoutDestination;
  /** The player's live wallet at read time. */
  wallet: WalletView;
};

type WithdrawalRowWithSecret = WithdrawalRow & {
  paymentDetails?: {
    accountHolderName?: string;
    accountNumber?: string;
    ifsc?: string;
    bankName?: string;
    upiId?: string;
  };
};

function toListItem(row: WithdrawalRow, player: AdminWithdrawalPlayer): AdminWithdrawalListItem {
  return {
    id: row._id.toString(),
    player,
    method: row.method as WithdrawalMethod,
    amountPaise: row.amountPaise,
    status: row.status as WithdrawalStatus,
    destinationSummary: row.destinationSummary,
    rejectionReason: row.status === "REJECTED" ? row.rejectionReason ?? null : null,
    paymentReference: row.paymentReference ?? null,
    decidedByAdminId: row.decidedByAdminId ? row.decidedByAdminId.toString() : null,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function payoutDestinationOf(row: WithdrawalRowWithSecret): AdminPayoutDestination {
  const details = row.paymentDetails ?? {};
  if (row.method === "BANK") {
    return {
      method: "BANK",
      accountHolderName: details.accountHolderName ?? "",
      accountNumber: details.accountNumber ?? "",
      ifsc: details.ifsc ?? "",
      bankName: details.bankName ?? null,
    };
  }
  return { method: "UPI", upiId: details.upiId ?? "" };
}

// --- player summary batch loader -----------------------------------------------------

async function playersByIds(ids: Types.ObjectId[]): Promise<Map<string, AdminWithdrawalPlayer>> {
  if (ids.length === 0) return new Map();
  const rows = await User.find({ _id: { $in: ids } })
    .select({ loginId: 1, name: 1 })
    .lean<{ _id: Types.ObjectId; loginId: string; name: string }[]>();
  return new Map(
    rows.map((row) => [row._id.toString(), { id: row._id.toString(), loginId: row.loginId, name: row.name }]),
  );
}

const UNKNOWN_PLAYER = (id: Types.ObjectId): AdminWithdrawalPlayer => ({
  id: id.toString(),
  loginId: "(deleted)",
  name: "(deleted player)",
});

// --- list -----------------------------------------------------------------------------

export type ListWithdrawalsForAdminOptions = {
  status?: WithdrawalStatus;
  method?: WithdrawalMethod;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  cursor?: string;
};

export type AdminWithdrawalsPage = {
  withdrawals: AdminWithdrawalListItem[];
  nextCursor: string | null;
};

/** Resolve a free-text player search to the matching PLAYER ids (normalized loginId / email
 *  substring, exact phone). Returns `[]` when nothing matches so the list is empty, not global. */
async function searchPlayerIds(search: string): Promise<Types.ObjectId[]> {
  const raw = search.trim();
  const contains = new RegExp(escapeRegex(normalizeLoginId(raw)), "i");
  const rows = await User.find({
    role: "PLAYER",
    $or: [{ loginId: contains }, { email: contains }, { phone: raw }],
  })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }[]>();
  return rows.map((row) => row._id);
}

/**
 * Global withdrawal list, newest **requested** first, ALWAYS bounded (`limit` 1–100, default
 * 25). Stable order is `requestedAt` desc then `_id` desc; the opaque cursor carries the last
 * row's `(requestedAt, _id)`. Player summaries are batch-loaded (one `$in`) — no N+1. No raw
 * `paymentDetails` in any row.
 */
export async function listWithdrawalsForAdmin(
  options: ListWithdrawalsForAdminOptions = {},
): Promise<AdminWithdrawalsPage> {
  const limit = clampLimit(options.limit, ADMIN_WITHDRAWAL_LIST_DEFAULT_LIMIT, ADMIN_WITHDRAWAL_LIST_MAX_LIMIT);

  const and: Record<string, unknown>[] = [];
  if (options.search !== undefined) {
    const ids = await searchPlayerIds(options.search);
    if (ids.length === 0) return { withdrawals: [], nextCursor: null };
    and.push({ userId: { $in: ids } });
  }
  const requestedAt: Record<string, Date> = {};
  if (options.dateFrom) requestedAt.$gte = new Date(options.dateFrom);
  if (options.dateTo) requestedAt.$lte = new Date(options.dateTo);
  if (Object.keys(requestedAt).length) and.push({ requestedAt });
  if (options.cursor) and.push({ $or: olderThan("requestedAt", decodeCursor(options.cursor)) });

  const filter: QueryFilter<WithdrawalRow> = {};
  if (options.status) filter.status = options.status;
  if (options.method) filter.method = options.method;
  if (and.length) filter.$and = and;

  const rows = await Withdrawal.find(filter)
    .sort({ requestedAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<WithdrawalRow[]>();

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeCursor(last.requestedAt, last._id) : null;

  const players = await playersByIds([...new Set(page.map((r) => r.userId.toString()))].map((id) => new Types.ObjectId(id)));
  const withdrawals = page.map((row) =>
    toListItem(row, players.get(row.userId.toString()) ?? UNKNOWN_PLAYER(row.userId)),
  );
  return { withdrawals, nextCursor };
}

// --- detail (sensitive) -------------------------------------------------------------

/**
 * One withdrawal with everything the admin needs to make the real out-of-Diamond payment,
 * INCLUDING the raw BANK / UPI `payoutDestination`. This is the ONLY endpoint that returns it.
 * A missing / malformed id is `WITHDRAWAL_NOT_FOUND` (404).
 */
export async function getWithdrawalDetailForAdmin(id: string): Promise<AdminWithdrawalDetail> {
  const trimmed = id.trim();
  if (!HEX24.test(trimmed)) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  const row = await Withdrawal.findById(new Types.ObjectId(trimmed))
    .select("+paymentDetails")
    .lean<WithdrawalRowWithSecret>();
  if (!row) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");

  const players = await playersByIds([row.userId]);
  const player = players.get(row.userId.toString()) ?? UNKNOWN_PLAYER(row.userId);
  return {
    ...toListItem(row, player),
    decisionNote: row.decisionNote ?? null,
    payoutDestination: payoutDestinationOf(row),
    wallet: await getWalletView(row.userId),
  };
}

// --- Mark Paid & Approve / Reject -------------------------------------------------

export type AdminWithdrawalDecisionInput = {
  actorAdminId: Types.ObjectId;
  /** The withdrawal's 24-hex id handle. */
  withdrawalId: string;
  /** Admin's client UUID — the idempotency key for this decision. */
  clientRequestId: string;
  note?: string;
};
export type ApproveWithdrawalOpInput = AdminWithdrawalDecisionInput & { paymentReference?: string };
export type RejectWithdrawalOpInput = AdminWithdrawalDecisionInput & { reason: string };

export type AdminWithdrawalDecisionResult = {
  withdrawal: AdminWithdrawalListItem;
  idempotentReplay: boolean;
  serverNow: string;
};

function resolveWithdrawalId(id: string): Types.ObjectId {
  const trimmed = id.trim();
  if (!HEX24.test(trimmed)) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  return new Types.ObjectId(trimmed);
}

async function listItemFor(withdrawalId: Types.ObjectId): Promise<AdminWithdrawalListItem> {
  const row = await Withdrawal.findById(withdrawalId).lean<WithdrawalRow>();
  if (!row) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  const players = await playersByIds([row.userId]);
  return toListItem(row, players.get(row.userId.toString()) ?? UNKNOWN_PLAYER(row.userId));
}

type DecisionKind = "APPROVE" | "REJECT";
const TERMINAL: Record<DecisionKind, WithdrawalStatus> = { APPROVE: "APPROVED", REJECT: "REJECTED" };

/**
 * Existing-success recovery for a decision idempotency key. Returns the original list item on an
 * exact replay; throws `DUPLICATE_REQUEST` when the same `clientRequestId` was used for a
 * different withdrawal or a materially different decision; returns `null` when the key is unused.
 */
async function recoverDecision(
  kind: DecisionKind,
  withdrawalId: Types.ObjectId,
  input: ApproveWithdrawalOpInput | RejectWithdrawalOpInput,
): Promise<AdminWithdrawalListItem | null> {
  const prior = await Withdrawal.findOne({ decisionRequestId: input.clientRequestId }).lean<WithdrawalRow>();
  if (!prior) return null;
  const paymentReference = "paymentReference" in input ? input.paymentReference?.trim() || undefined : undefined;
  const note = input.note?.trim() || undefined;
  const reason = "reason" in input ? input.reason.trim() : undefined;
  if (
    !prior._id.equals(withdrawalId)
    || prior.status !== TERMINAL[kind]
    || !prior.decidedByAdminId?.equals(input.actorAdminId)
    || !sameText(prior.paymentReference, paymentReference)
    || !sameText(prior.decisionNote, note)
    || (kind === "REJECT" && !sameText(prior.rejectionReason, reason))
  ) {
    throw new DomainError(
      "DUPLICATE_REQUEST",
      "This request id was already used for a different withdrawal decision.",
    );
  }
  const players = await playersByIds([prior.userId]);
  return toListItem(prior, players.get(prior.userId.toString()) ?? UNKNOWN_PLAYER(prior.userId));
}

async function runDecision(
  kind: DecisionKind,
  input: ApproveWithdrawalOpInput | RejectWithdrawalOpInput,
  options: WithdrawalMutationOptions,
): Promise<AdminWithdrawalDecisionResult> {
  const clock = options.clock ?? (() => new Date());
  const withdrawalId = resolveWithdrawalId(input.withdrawalId);
  const note = input.note?.trim() || undefined;
  const paymentReference = "paymentReference" in input ? input.paymentReference?.trim() || undefined : undefined;
  const reason = "reason" in input ? input.reason.trim() : undefined;
  if (kind === "REJECT" && !reason) throw new DomainError("INVALID_INPUT", "A rejection reason is required.");

  // Existing-success idempotency recovery FIRST — an exact `(withdrawal, decisionRequestId)`
  // replay with the same payload returns the original decision.
  const replay = await recoverDecision(kind, withdrawalId, input);
  if (replay) return { withdrawal: replay, idempotentReplay: true, serverNow: clock().toISOString() };

  const current = await Withdrawal.findById(withdrawalId).lean<WithdrawalRow>();
  if (!current) throw new DomainError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found.");
  if (current.status === TERMINAL[kind]) {
    // Already in the state this op wants — a concurrent or earlier decision (possibly under a
    // different request id) won. Retry-safe: report success without moving money again. A
    // reuse of THIS request id for a different withdrawal / decision was already rejected above.
    const players = await playersByIds([current.userId]);
    return {
      withdrawal: toListItem(current, players.get(current.userId.toString()) ?? UNKNOWN_PLAYER(current.userId)),
      idempotentReplay: true,
      serverNow: clock().toISOString(),
    };
  }
  if (current.status !== "PENDING") {
    // Reached the OTHER terminal state (approve-vs-reject, or a player cancel won) — a real conflict.
    throw new DomainError("WITHDRAWAL_NOT_PENDING", "This withdrawal is not pending and cannot be changed.");
  }

  const auditAction = kind === "APPROVE" ? "WITHDRAWAL_APPROVED" : "WITHDRAWAL_REJECTED";
  const mutationOptions: WithdrawalMutationOptions = {
    ...options,
    onTransition: (session) =>
      writeAuditLog(
        {
          actorAdminId: input.actorAdminId,
          action: auditAction,
          entityType: "Withdrawal",
          entityId: withdrawalId,
          subjectUserId: current.userId,
          before: { status: "PENDING" },
          after: {
            status: TERMINAL[kind],
            amountPaise: current.amountPaise,
            method: current.method,
            // Deliberately NO raw payout destination here — only the masked summary.
            destinationSummary: current.destinationSummary,
            ...(paymentReference ? { paymentReference } : {}),
            ...(reason ? { reason } : {}),
            ...(note ? { note } : {}),
          },
        },
        session,
      ),
  };

  try {
    if (kind === "APPROVE") {
      await approveWithdrawalByAdmin(
        {
          withdrawalId,
          adminId: input.actorAdminId,
          decisionRequestId: input.clientRequestId,
          paymentReference,
          decisionNote: note,
        },
        mutationOptions,
      );
    } else {
      await rejectWithdrawalByAdmin(
        {
          withdrawalId,
          adminId: input.actorAdminId,
          reason: reason!,
          decisionRequestId: input.clientRequestId,
          decisionNote: note,
        },
        mutationOptions,
      );
    }
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const raced = await recoverDecision(kind, withdrawalId, input);
      if (raced) return { withdrawal: raced, idempotentReplay: true, serverNow: clock().toISOString() };
      throw new DomainError(
        "DUPLICATE_REQUEST",
        "This request id was already used for a different withdrawal decision.",
      );
    }
    throw error;
  }

  return { withdrawal: await listItemFor(withdrawalId), idempotentReplay: false, serverNow: clock().toISOString() };
}

/**
 * **Mark Paid & Approve.** Requires an ACTIVE admin (route), a PENDING withdrawal and an
 * explicit `confirmPaid: true` (validator). Atomically: finalize the reserved amount
 * (`reserved -= X`, available UNCHANGED — never a second debit), `PENDING → APPROVED`, one
 * immutable `WITHDRAWAL_APPROVED` ledger row, decision metadata (`decidedByAdminId`,
 * `paymentReference`, `decisionNote`, `decisionRequestId`), one `WITHDRAWAL_APPROVED` audit row.
 * No real bank/UPI transfer happens. Idempotent on `(withdrawal, decisionRequestId)`; a
 * conflicting reuse is `DUPLICATE_REQUEST`.
 */
export function approveWithdrawalOp(
  input: ApproveWithdrawalOpInput,
  options: WithdrawalMutationOptions = {},
): Promise<AdminWithdrawalDecisionResult> {
  return runDecision("APPROVE", input, options);
}

/**
 * Reject a PENDING withdrawal with a required bounded reason. Atomically: `reserved -= X`,
 * `available += X`, `PENDING → REJECTED`, one `WITHDRAWAL_RELEASED` ledger row, one
 * `WITHDRAWAL_REJECTED` audit row. No earlier transaction is edited or deleted. Idempotent on
 * `(withdrawal, decisionRequestId)`.
 */
export function rejectWithdrawalOp(
  input: RejectWithdrawalOpInput,
  options: WithdrawalMutationOptions = {},
): Promise<AdminWithdrawalDecisionResult> {
  return runDecision("REJECT", input, options);
}
