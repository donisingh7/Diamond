import "server-only";
import { Types, type ClientSession } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { writeAuditLog } from "@/modules/audit/services/audit-log.service";
import {
  PaymentMethod,
  type PaymentMethodDoc,
  type PaymentMethodRow,
} from "../models/payment-method.model";
import {
  maskAccountNumber,
  type CreatePaymentMethodRequest,
  type UpdatePaymentMethodRequest,
} from "../validators/payment-input";

/**
 * Window 10A — admin payment-method configuration + the player's read of what is live.
 *
 *  - create / update / activate / deactivate: ADMIN only at the route, audited here
 *    (`PAYMENT_METHOD_CREATED` / `PAYMENT_METHOD_UPDATED`; a full account number never enters
 *    the audit row — only a `••••1234` mask).
 *  - `type` is immutable: an update that carries fields for the other kind is rejected.
 *  - a method is never deleted — `isActive: false` hides it from players while every historical
 *    DepositRequest keeps the snapshot it took at submit time.
 *  - players see ACTIVE methods only, with the coordinates they need to actually pay.
 */

const HEX24 = /^[a-f0-9]{24}$/i;
const UPI_ONLY: (keyof UpdatePaymentMethodRequest)[] = ["upiId", "qrImageId"];
const BANK_ONLY: (keyof UpdatePaymentMethodRequest)[] = ["accountHolderName", "bankName", "accountNumber", "ifsc"];

// --- DTOs --------------------------------------------------------------------------------

export type PaymentMethodAdminDTO = {
  id: string;
  type: "UPI" | "BANK";
  displayName: string;
  instructions: string | null;
  isActive: boolean;
  sortOrder: number;
  upiId: string | null;
  qrImageId: string | null;
  accountHolderName: string | null;
  bankName: string | null;
  accountNumberMasked: string | null;
  ifsc: string | null;
  createdAt: string;
  updatedAt: string;
};

/** What a player needs to pay: full coordinates for an ACTIVE method. */
export type PaymentMethodPlayerDTO = {
  id: string;
  type: "UPI" | "BANK";
  displayName: string;
  instructions: string | null;
  sortOrder: number;
  upiId: string | null;
  qrImageId: string | null;
  accountHolderName: string | null;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
};

export function toPaymentMethodAdminDTO(row: PaymentMethodRow): PaymentMethodAdminDTO {
  return {
    id: row._id.toString(),
    type: row.type,
    displayName: row.displayName,
    instructions: row.instructions ?? null,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    upiId: row.upiId ?? null,
    qrImageId: row.qrImageId ? row.qrImageId.toString() : null,
    accountHolderName: row.accountHolderName ?? null,
    bankName: row.bankName ?? null,
    accountNumberMasked: row.accountNumber ? maskAccountNumber(row.accountNumber) : null,
    ifsc: row.ifsc ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPaymentMethodPlayerDTO(row: PaymentMethodRow): PaymentMethodPlayerDTO {
  return {
    id: row._id.toString(),
    type: row.type,
    displayName: row.displayName,
    instructions: row.instructions ?? null,
    sortOrder: row.sortOrder,
    upiId: row.upiId ?? null,
    qrImageId: row.qrImageId ? row.qrImageId.toString() : null,
    accountHolderName: row.accountHolderName ?? null,
    bankName: row.bankName ?? null,
    accountNumber: row.accountNumber ?? null,
    ifsc: row.ifsc ?? null,
  };
}

/** Non-sensitive audit projection — never a full account number. */
function auditView(row: PaymentMethodRow | PaymentMethodDoc) {
  return {
    paymentMethodId: row._id.toString(),
    type: row.type,
    displayName: row.displayName,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    upiId: row.upiId ?? null,
    bankName: row.bankName ?? null,
    accountNumberMasked: row.accountNumber ? maskAccountNumber(row.accountNumber) : null,
    ifsc: row.ifsc ?? null,
  };
}

// --- reads --------------------------------------------------------------------------------

export async function listPaymentMethodsForAdmin(): Promise<PaymentMethodAdminDTO[]> {
  const rows = await PaymentMethod.find({}).sort({ sortOrder: 1, _id: 1 }).lean<PaymentMethodRow[]>();
  return rows.map(toPaymentMethodAdminDTO);
}

export async function listActivePaymentMethodsForPlayer(): Promise<PaymentMethodPlayerDTO[]> {
  const rows = await PaymentMethod.find({ isActive: true }).sort({ sortOrder: 1, _id: 1 }).lean<PaymentMethodRow[]>();
  return rows.map(toPaymentMethodPlayerDTO);
}

/**
 * Resolve a method that MUST be usable for a new deposit right now: it exists
 * (`PAYMENT_METHOD_NOT_FOUND`) and is active (`PAYMENT_METHOD_INACTIVE`).
 */
export async function resolveActivePaymentMethod(id: string, session?: ClientSession): Promise<PaymentMethodDoc> {
  if (!HEX24.test(id)) throw new DomainError("PAYMENT_METHOD_NOT_FOUND", "Payment method not found.");
  const query = PaymentMethod.findById(new Types.ObjectId(id));
  if (session) query.session(session);
  const method = await query;
  if (!method) throw new DomainError("PAYMENT_METHOD_NOT_FOUND", "Payment method not found.");
  if (!method.isActive) throw new DomainError("PAYMENT_METHOD_INACTIVE", "This payment method is no longer available.");
  return method;
}

/** Frozen display coordinates for a DepositRequest — account number masked. */
export function buildPaymentMethodSnapshot(method: PaymentMethodDoc) {
  return {
    paymentMethodId: method._id,
    type: method.type,
    displayName: method.displayName,
    instructions: method.instructions ?? undefined,
    upiId: method.upiId ?? undefined,
    accountHolderName: method.accountHolderName ?? undefined,
    bankName: method.bankName ?? undefined,
    accountNumberMasked: method.accountNumber ? maskAccountNumber(method.accountNumber) : undefined,
    ifsc: method.ifsc ?? undefined,
  };
}

// --- writes -------------------------------------------------------------------------------

export type CreatePaymentMethodServiceInput = { actorAdminId: Types.ObjectId; request: CreatePaymentMethodRequest };

export async function createPaymentMethod(input: CreatePaymentMethodServiceInput): Promise<PaymentMethodAdminDTO> {
  const { request } = input;
  const doc = new PaymentMethod({
    type: request.type,
    displayName: request.displayName,
    instructions: request.instructions,
    isActive: request.isActive ?? true,
    sortOrder: request.sortOrder ?? 0,
    createdByAdminId: input.actorAdminId,
    updatedByAdminId: input.actorAdminId,
    ...(request.type === "UPI"
      ? { upiId: request.upiId, qrImageId: request.qrImageId ? new Types.ObjectId(request.qrImageId) : undefined }
      : {
          accountHolderName: request.accountHolderName,
          bankName: request.bankName,
          accountNumber: request.accountNumber,
          ifsc: request.ifsc,
        }),
  });
  await doc.save();

  await writeAuditLog({
    actorAdminId: input.actorAdminId,
    action: "PAYMENT_METHOD_CREATED",
    entityType: "PaymentMethod",
    entityId: doc._id,
    after: auditView(doc),
  });

  const row = doc.toObject() as unknown as PaymentMethodRow;
  return toPaymentMethodAdminDTO(row);
}

export type UpdatePaymentMethodServiceInput = {
  actorAdminId: Types.ObjectId;
  id: string;
  patch: UpdatePaymentMethodRequest;
};

export async function updatePaymentMethod(input: UpdatePaymentMethodServiceInput): Promise<PaymentMethodAdminDTO> {
  if (!HEX24.test(input.id)) throw new DomainError("PAYMENT_METHOD_NOT_FOUND", "Payment method not found.");
  const method = await PaymentMethod.findById(new Types.ObjectId(input.id));
  if (!method) throw new DomainError("PAYMENT_METHOD_NOT_FOUND", "Payment method not found.");

  const forbidden = method.type === "UPI" ? BANK_ONLY : UPI_ONLY;
  for (const key of forbidden) {
    if (input.patch[key] !== undefined) {
      throw new DomainError("INVALID_INPUT", `A ${method.type} method cannot take '${String(key)}'.`);
    }
  }

  const before = auditView(method);
  const patch = input.patch;
  if (patch.displayName !== undefined) method.displayName = patch.displayName;
  if (patch.instructions !== undefined) method.instructions = patch.instructions;
  if (patch.isActive !== undefined) method.isActive = patch.isActive;
  if (patch.sortOrder !== undefined) method.sortOrder = patch.sortOrder;
  if (patch.upiId !== undefined) method.upiId = patch.upiId;
  if (patch.qrImageId !== undefined) method.qrImageId = new Types.ObjectId(patch.qrImageId);
  if (patch.accountHolderName !== undefined) method.accountHolderName = patch.accountHolderName;
  if (patch.bankName !== undefined) method.bankName = patch.bankName;
  if (patch.accountNumber !== undefined) method.accountNumber = patch.accountNumber;
  if (patch.ifsc !== undefined) method.ifsc = patch.ifsc;
  method.updatedByAdminId = input.actorAdminId;

  await method.save();

  await writeAuditLog({
    actorAdminId: input.actorAdminId,
    action: "PAYMENT_METHOD_UPDATED",
    entityType: "PaymentMethod",
    entityId: method._id,
    before,
    after: auditView(method),
  });

  const row = method.toObject() as unknown as PaymentMethodRow;
  return toPaymentMethodAdminDTO(row);
}
