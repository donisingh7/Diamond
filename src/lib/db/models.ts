import { User } from "@/modules/users/models/user.model";
import { Session } from "@/modules/auth/models/session.model";
import { OtpRequest } from "@/modules/auth/models/otp-request.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { Market } from "@/modules/markets/models/market.model";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { BetRevision } from "@/modules/betting/models/bet-revision.model";
import { Withdrawal } from "@/modules/withdrawals/models/withdrawal.model";
import { AuditLog } from "@/modules/audit/models/audit-log.model";
import { PlatformSettings } from "@/modules/settings/models/platform-settings.model";
import { PaymentMethod } from "@/modules/payments/models/payment-method.model";
import { DepositRequest } from "@/modules/payments/models/deposit-request.model";
import { ProofImage } from "@/modules/payments/models/proof-image.model";

export const models = [User, Session, OtpRequest, Wallet, WalletTransaction, Market, MarketRound, Bet, BetRevision, Withdrawal, AuditLog, PlatformSettings, PaymentMethod, DepositRequest, ProofImage] as const;

/** Add declared indexes; never drop existing indexes as syncIndexes would. */
export async function ensureIndexes(): Promise<void> {
  for (const model of models) await model.createIndexes();
}
