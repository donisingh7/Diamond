import "server-only";
import { Types, type QueryFilter } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import { createPlayerWallet, creditAvailableInSession, isDuplicateKeyError } from "@/modules/wallet/services/wallet.service";
import { writeAuditLog } from "@/modules/audit/services/audit-log.service";
import { clampLimit, decodeCursor, encodeCursor, olderThan } from "@/modules/admin/services/pagination";
import {
  DepositRequest,
  type DepositRequestRow,
  type DepositRequestStatus,
} from "../models/deposit-request.model";
import { normalizeUtr, type SubmitDepositRequest } from "../validators/payment-input";
import { buildPaymentMethodSnapshot, resolveActivePaymentMethod } from "./payment-method.service";
import { getProofImageMeta } from "./proof-image.service";

/**
 * Window 10A — the DepositRequest lifecycle.
 *
 *  submit  : PLAYER, retry-safe on `(userId, clientRequestId)`, one PENDING row + a frozen
 *            payment-method snapshot; the method must be ACTIVE and the proof must be the
 *            caller's own `DEPOSIT_PROOF` image; `normalizedUtr` is globally unique
 *            (`DUPLICATE_UTR`).
 *  approve : ADMIN, PENDING → APPROVED in ONE transaction — status CAS + a single
 *            `DEPOSIT_CREDIT` ledger row keyed `DEPOSIT_CREDIT:<id>` (available += the
 *            admin's `approvedAmountPaise`, which MAY differ from the requested amount — the
 *            original is never overwritten) + one `DEPOSIT_APPROVED` audit row. A double click
 *            / retry / concurrent call credits at most once (CAS + unique idempotency key).
 *  reject  : ADMIN, PENDING → REJECTED, mandatory `adminRemark`, NO wallet movement.
 *
 * Only PENDING is mutable; a REJECTED request can never later credit.
 */

const HEX24 = /^[a-f0-9]{24}$/i;
const DEPOSIT_REFERENCE_TYPE = "DEPOSIT_REQUEST";

export function depositCreditKey(depositRequestId: Types.ObjectId): string {
  return `DEPOSIT_CREDIT:${depositRequestId.toHexString()}`;
}

// --- DTOs --------------------------------------------------------------------------------

type SnapshotDTO = {
  type: "UPI" | "BANK";
  displayName: string;
  instructions: string | null;
  upiId: string | null;
  accountHolderName: string | null;
  bankName: string | null;
  accountNumberMasked: string | null;
  ifsc: string | null;
};

export type PlayerDepositRequestDTO = {
  id: string;
  status: DepositRequestStatus;
  requestedAmountPaise: number;
  approvedAmountPaise: number | null;
  paymentMethodId: string;
  paymentMethodSnapshot: SnapshotDTO;
  utr: string;
  proofImageId: string;
  adminRemark: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminDepositRequestDTO = PlayerDepositRequestDTO & {
  userId: string;
  reviewedByAdminId: string | null;
};

function snapshotDTO(row: DepositRequestRow): SnapshotDTO {
  const s = row.paymentMethodSnapshot;
  return {
    type: s.type,
    displayName: s.displayName,
    instructions: s.instructions ?? null,
    upiId: s.upiId ?? null,
    accountHolderName: s.accountHolderName ?? null,
    bankName: s.bankName ?? null,
    accountNumberMasked: s.accountNumberMasked ?? null,
    ifsc: s.ifsc ?? null,
  };
}

export function toPlayerDepositRequestDTO(row: DepositRequestRow): PlayerDepositRequestDTO {
  return {
    id: row._id.toString(),
    status: row.status,
    requestedAmountPaise: row.requestedAmountPaise,
    approvedAmountPaise: row.approvedAmountPaise ?? null,
    paymentMethodId: row.paymentMethodId.toString(),
    paymentMethodSnapshot: snapshotDTO(row),
    utr: row.utr,
    proofImageId: row.proofImageId.toString(),
    adminRemark: row.adminRemark ?? null,
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAdminDepositRequestDTO(row: DepositRequestRow): AdminDepositRequestDTO {
  return {
    ...toPlayerDepositRequestDTO(row),
    userId: row.userId.toString(),
    reviewedByAdminId: row.reviewedByAdminId ? row.reviewedByAdminId.toString() : null,
  };
}

/** Never a full UTR in an audit row. */
function maskUtr(normalized: string): string {
  return normalized.length <= 4 ? "••••" : `••••${normalized.slice(-4)}`;
}

// --- submit -----------------------------------------------------------------------------

export type SubmitDepositServiceInput = { userId: Types.ObjectId; request: SubmitDepositRequest };

export async function submitDepositRequest(input: SubmitDepositServiceInput): Promise<PlayerDepositRequestDTO> {
  const { userId, request } = input;

  const existing = await DepositRequest.findOne({ userId, clientRequestId: request.clientRequestId }).lean<DepositRequestRow>();
  if (existing) return toPlayerDepositRequestDTO(existing);

  const normalizedUtr = normalizeUtr(request.utr);
  if (normalizedUtr.length < 4) {
    throw new DomainError("INVALID_INPUT", "The transaction reference (UTR) is too short.");
  }

  const method = await resolveActivePaymentMethod(request.paymentMethodId);

  const proof = await getProofImageMeta(request.proofImageId);
  if (proof.kind !== "DEPOSIT_PROOF" || !proof.ownerId.equals(userId)) {
    throw new DomainError("IMAGE_NOT_FOUND", "Proof image not found.");
  }

  const utrClash = await DepositRequest.findOne({ normalizedUtr }).lean<DepositRequestRow>();
  if (utrClash) throw new DomainError("DUPLICATE_UTR", "This transaction reference has already been submitted.");

  const now = new Date();
  try {
    const doc = await DepositRequest.create({
      userId,
      clientRequestId: request.clientRequestId,
      requestedAmountPaise: request.requestedAmountPaise,
      paymentMethodId: method._id,
      paymentMethodSnapshot: buildPaymentMethodSnapshot(method),
      utr: request.utr.trim(),
      normalizedUtr,
      proofImageId: proof._id,
      status: "PENDING",
      submittedAt: now,
    });
    return toPlayerDepositRequestDTO(doc.toObject() as unknown as DepositRequestRow);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const raced = await DepositRequest.findOne({ userId, clientRequestId: request.clientRequestId }).lean<DepositRequestRow>();
      if (raced) return toPlayerDepositRequestDTO(raced);
      throw new DomainError("DUPLICATE_UTR", "This transaction reference has already been submitted.");
    }
    throw error;
  }
}

// --- reads ------------------------------------------------------------------------------

export type ListDepositsOptions = { status?: DepositRequestStatus; limit?: number; cursor?: string };

async function pageDeposits(
  filter: QueryFilter<DepositRequestRow>,
  limit: number,
  cursor: string | undefined,
): Promise<{ rows: DepositRequestRow[]; nextCursor: string | null }> {
  const query: QueryFilter<DepositRequestRow> = { ...filter };
  if (cursor) query.$or = olderThan("submittedAt", decodeCursor(cursor));

  const rows = await DepositRequest.find(query)
    .sort({ submittedAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<DepositRequestRow[]>();

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeCursor(last.submittedAt, last._id) : null;
  return { rows: page, nextCursor };
}

export type PlayerDepositsPage = { deposits: PlayerDepositRequestDTO[]; nextCursor: string | null };

export async function listPlayerDepositRequests(
  userId: Types.ObjectId,
  options: ListDepositsOptions = {},
): Promise<PlayerDepositsPage> {
  const limit = clampLimit(options.limit, 20, 50);
  const filter: QueryFilter<DepositRequestRow> = { userId };
  if (options.status) filter.status = options.status;
  const { rows, nextCursor } = await pageDeposits(filter, limit, options.cursor);
  return { deposits: rows.map(toPlayerDepositRequestDTO), nextCursor };
}

export async function getPlayerDepositRequest(userId: Types.ObjectId, id: string): Promise<PlayerDepositRequestDTO> {
  if (!HEX24.test(id.trim())) throw new DomainError("DEPOSIT_REQUEST_NOT_FOUND", "Deposit request not found.");
  const row = await DepositRequest.findOne({ _id: new Types.ObjectId(id.trim()), userId }).lean<DepositRequestRow>();
  if (!row) throw new DomainError("DEPOSIT_REQUEST_NOT_FOUND", "Deposit request not found.");
  return toPlayerDepositRequestDTO(row);
}

export type AdminDepositsPage = { deposits: AdminDepositRequestDTO[]; nextCursor: string | null };

export async function listDepositRequestsForAdmin(
  options: ListDepositsOptions & { userId?: string } = {},
): Promise<AdminDepositsPage> {
  const limit = clampLimit(options.limit, 25, 100);
  const filter: QueryFilter<DepositRequestRow> = {};
  if (options.status) filter.status = options.status;
  if (options.userId) {
    if (!HEX24.test(options.userId)) throw new DomainError("INVALID_INPUT", "Invalid user id filter.");
    filter.userId = new Types.ObjectId(options.userId);
  }
  const { rows, nextCursor } = await pageDeposits(filter, limit, options.cursor);
  return { deposits: rows.map(toAdminDepositRequestDTO), nextCursor };
}

export async function getDepositRequestForAdmin(id: string): Promise<AdminDepositRequestDTO> {
  if (!HEX24.test(id.trim())) throw new DomainError("DEPOSIT_REQUEST_NOT_FOUND", "Deposit request not found.");
  const row = await DepositRequest.findById(new Types.ObjectId(id.trim())).lean<DepositRequestRow>();
  if (!row) throw new DomainError("DEPOSIT_REQUEST_NOT_FOUND", "Deposit request not found.");
  return toAdminDepositRequestDTO(row);
}

// --- review (approve / reject) --------------------------------------------------------

async function loadForReview(id: string): Promise<DepositRequestRow> {
  if (!HEX24.test(id.trim())) throw new DomainError("DEPOSIT_REQUEST_NOT_FOUND", "Deposit request not found.");
  const row = await DepositRequest.findById(new Types.ObjectId(id.trim())).lean<DepositRequestRow>();
  if (!row) throw new DomainError("DEPOSIT_REQUEST_NOT_FOUND", "Deposit request not found.");
  return row;
}

export type ApproveDepositServiceInput = {
  actorAdminId: Types.ObjectId;
  depositRequestId: string;
  approvedAmountPaise: number;
  adminRemark?: string;
};

export async function approveDepositRequest(input: ApproveDepositServiceInput): Promise<AdminDepositRequestDTO> {
  if (!Number.isSafeInteger(input.approvedAmountPaise) || input.approvedAmountPaise < 1) {
    throw new DomainError("INVALID_AMOUNT", "The approved amount must be a positive whole number of paise.");
  }
  const current = await loadForReview(input.depositRequestId);
  const requestId = current._id;
  const remark = input.adminRemark?.trim() || undefined;

  if (current.status === "APPROVED") return getDepositRequestForAdmin(requestId.toString());
  if (current.status !== "PENDING") throw new DomainError("DEPOSIT_NOT_PENDING", "This deposit request is not pending.");
  if (input.approvedAmountPaise !== current.requestedAmountPaise && !remark) {
    throw new DomainError("INVALID_INPUT", "Approving a different amount requires an admin remark.");
  }

  // A player who has never transacted has no wallet row yet; ensure a ₹0 one exists (grants
  // nothing) so the credit lands rather than failing WALLET_NOT_FOUND.
  await createPlayerWallet(current.userId);

  try {
    await withTransaction(async (session) => {
      const now = new Date();
      const res = await DepositRequest.collection.updateOne(
        { _id: requestId, status: "PENDING" },
        {
          $set: {
            status: "APPROVED",
            approvedAmountPaise: input.approvedAmountPaise,
            ...(remark ? { adminRemark: remark } : {}),
            reviewedByAdminId: input.actorAdminId,
            reviewedAt: now,
            updatedAt: now,
          },
        },
        { session },
      );
      if (res.matchedCount !== 1) throw new DomainError("DEPOSIT_NOT_PENDING", "This deposit request is not pending.");

      await creditAvailableInSession(
        {
          userId: current.userId,
          type: "DEPOSIT_CREDIT",
          amountPaise: input.approvedAmountPaise,
          idempotencyKey: depositCreditKey(requestId),
          referenceType: DEPOSIT_REFERENCE_TYPE,
          referenceId: requestId,
        },
        session,
      );

      await writeAuditLog(
        {
          actorAdminId: input.actorAdminId,
          action: "DEPOSIT_APPROVED",
          entityType: "DepositRequest",
          entityId: requestId,
          subjectUserId: current.userId,
          after: {
            depositRequestId: requestId.toString(),
            requestedAmountPaise: current.requestedAmountPaise,
            approvedAmountPaise: input.approvedAmountPaise,
            amountChanged: input.approvedAmountPaise !== current.requestedAmountPaise,
            methodType: current.paymentMethodSnapshot.type,
            utrMasked: maskUtr(current.normalizedUtr),
            adminRemark: remark ?? null,
          },
        },
        session,
      );
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const settled = await DepositRequest.findById(requestId).lean<DepositRequestRow>();
      if (settled?.status === "APPROVED") return toAdminDepositRequestDTO(settled);
    }
    throw error;
  }

  return getDepositRequestForAdmin(requestId.toString());
}

export type RejectDepositServiceInput = {
  actorAdminId: Types.ObjectId;
  depositRequestId: string;
  adminRemark: string;
};

export async function rejectDepositRequest(input: RejectDepositServiceInput): Promise<AdminDepositRequestDTO> {
  const remark = input.adminRemark.trim();
  if (!remark) throw new DomainError("INVALID_INPUT", "A rejection requires an admin remark.");

  const current = await loadForReview(input.depositRequestId);
  const requestId = current._id;

  if (current.status === "REJECTED") return getDepositRequestForAdmin(requestId.toString());
  if (current.status !== "PENDING") throw new DomainError("DEPOSIT_NOT_PENDING", "This deposit request is not pending.");

  await withTransaction(async (session) => {
    const now = new Date();
    const res = await DepositRequest.collection.updateOne(
      { _id: requestId, status: "PENDING" },
      {
        $set: {
          status: "REJECTED",
          adminRemark: remark,
          reviewedByAdminId: input.actorAdminId,
          reviewedAt: now,
          updatedAt: now,
        },
      },
      { session },
    );
    if (res.matchedCount !== 1) throw new DomainError("DEPOSIT_NOT_PENDING", "This deposit request is not pending.");

    await writeAuditLog(
      {
        actorAdminId: input.actorAdminId,
        action: "DEPOSIT_REJECTED",
        entityType: "DepositRequest",
        entityId: requestId,
        subjectUserId: current.userId,
        after: {
          depositRequestId: requestId.toString(),
          requestedAmountPaise: current.requestedAmountPaise,
          methodType: current.paymentMethodSnapshot.type,
          utrMasked: maskUtr(current.normalizedUtr),
          adminRemark: remark,
        },
      },
      session,
    );
  });

  return getDepositRequestForAdmin(requestId.toString());
}
