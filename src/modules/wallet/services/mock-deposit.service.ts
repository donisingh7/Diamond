import "server-only";
import type { Types } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import { getPlatformSettings } from "@/modules/settings/services/platform-settings.service";
import type { WalletTransactionDoc } from "../models/wallet-transaction.model";
import {
  applyWalletMovement,
  createPlayerWallet,
  getTransactionByIdempotencyKey,
  getWalletDoc,
  isDuplicateKeyError,
  toWalletView,
  type WalletView,
} from "./wallet.service";

/**
 * Mock Deposit — prototype only. No payment gateway, no Razorpay, no UPI, no async settlement:
 * an immediate, ledgered credit to `availableBalancePaise`. Minimum ₹1, no product maximum
 * (only safe-integer precision applies). DOMAIN_RULES.md "MOCK DEPOSIT".
 */

export const MOCK_DEPOSIT_MINIMUM_PAISE = 100;

/** user + operation + clientRequestId — never the amount alone (Window 4A2 brief §14). */
export function buildMockDepositKey(userId: Types.ObjectId, clientRequestId: string): string {
  return `MOCK_DEPOSIT:${userId.toHexString()}:${clientRequestId}`;
}

export function assertMockDepositAmount(amountPaise: number): number {
  if (!Number.isSafeInteger(amountPaise)) {
    throw new DomainError("MONEY_OUT_OF_RANGE", "Deposit amount must be a whole number of paise within supported precision.");
  }
  if (amountPaise < MOCK_DEPOSIT_MINIMUM_PAISE) {
    throw new DomainError("INVALID_AMOUNT", `Minimum mock deposit is ${MOCK_DEPOSIT_MINIMUM_PAISE} paise (₹1).`);
  }
  return amountPaise;
}

export type MockDepositResult = {
  transaction: { id: string; type: "MOCK_DEPOSIT"; amountPaise: number };
  wallet: WalletView;
};

export type MockDepositInput = {
  userId: Types.ObjectId;
  amountPaise: number;
  clientRequestId: string;
};

/**
 * Credits the player's available balance once, atomically with its ledger row. Safe to retry:
 * the same `clientRequestId` yields the same deterministic `idempotencyKey`, so a repeat call
 * recovers the original receipt without moving money again; reusing that id for a DIFFERENT
 * amount is a `DUPLICATE_REQUEST` conflict.
 */
export async function mockDeposit(input: MockDepositInput): Promise<MockDepositResult> {
  const { userId, amountPaise, clientRequestId } = input;

  const settings = await getPlatformSettings();
  if (!settings.mockDepositEnabled) {
    throw new DomainError("FORBIDDEN", "Mock deposit is disabled.");
  }
  assertMockDepositAmount(amountPaise);
  // A player always has a wallet for this operation; a new one is ₹0 (never granted funds).
  await createPlayerWallet(userId);

  const idempotencyKey = buildMockDepositKey(userId, clientRequestId);

  const prior = await getTransactionByIdempotencyKey(idempotencyKey);
  if (prior) return recoverReceipt(prior, userId, amountPaise);

  try {
    const result = await withTransaction((session) =>
      applyWalletMovement(
        { userId, type: "MOCK_DEPOSIT", amountPaise, idempotencyKey, referenceType: "MOCK_DEPOSIT" },
        session,
      ),
    );
    return {
      transaction: { id: result.transactionId.toHexString(), type: "MOCK_DEPOSIT", amountPaise },
      wallet: toWalletView({
        currency: "INR",
        availableBalancePaise: result.availableBalancePaise,
        reservedBalancePaise: result.reservedBalancePaise,
      }),
    };
  } catch (error) {
    // A concurrent identical request committed first: recover its result outside this aborted txn.
    if (isDuplicateKeyError(error)) {
      const raced = await getTransactionByIdempotencyKey(idempotencyKey);
      if (raced) return recoverReceipt(raced, userId, amountPaise);
    }
    throw error;
  }
}

async function recoverReceipt(
  tx: WalletTransactionDoc,
  userId: Types.ObjectId,
  amountPaise: number,
): Promise<MockDepositResult> {
  if (tx.type !== "MOCK_DEPOSIT" || tx.amountPaise !== amountPaise || !tx.userId.equals(userId)) {
    throw new DomainError("DUPLICATE_REQUEST", "This request id was already used for a different deposit.");
  }
  const wallet = await getWalletDoc(userId);
  return {
    transaction: { id: tx._id.toHexString(), type: "MOCK_DEPOSIT", amountPaise },
    wallet: toWalletView(wallet),
  };
}
