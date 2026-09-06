import type { ClientSession, Types } from "mongoose";
import type { walletTransactionTypes } from "../models/wallet-transaction.model";

/** Future sole balance writer; caller's transaction also covers the originating domain record. */
export interface WalletService {
  applyMovement(input: {
    userId: Types.ObjectId; type: (typeof walletTransactionTypes)[number];
    amountPaise: number; availableDeltaPaise: number; reservedDeltaPaise: number;
    idempotencyKey: string; referenceId: Types.ObjectId; referenceType: string;
    actorAdminId?: Types.ObjectId;
  }, session: ClientSession): Promise<{ transactionId: Types.ObjectId }>;
}
