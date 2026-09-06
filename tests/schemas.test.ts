import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { User } from "@/modules/users/models/user.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { WalletTransaction } from "@/modules/wallet/models/wallet-transaction.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { BetRevision } from "@/modules/betting/models/bet-revision.model";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import { Withdrawal } from "@/modules/withdrawals/models/withdrawal.model";
import { Session } from "@/modules/auth/models/session.model";
import { OtpRequest } from "@/modules/auth/models/otp-request.model";
import { selectionNumberSchema } from "@/modules/betting/validators/bet-input";
import { models } from "@/lib/db/models";

const userId = new Types.ObjectId();
const composition = { entryMethod: "JODI", entryMetadata: { numbers: ["07"] }, selections: [{ number: "07", stakePaise: 100 }], totalStakePaise: 100 };
const bet = () => new Bet({ ...composition, publicRef: "FB-0906-X7K29", clientRequestId: "req-1", userId,
  marketId: new Types.ObjectId(), marketRoundId: new Types.ObjectId(), totalSelections: 1,
  payoutMultiplierSnapshot: 90, placedAt: new Date() });

describe("canonical schemas", () => {
  it("normalizes identity and omits blank optional sparse fields", async () => {
    const user = new User({ role: "PLAYER", loginId: " ＰLayer1 ", name: "Player", passwordHash: "test-hash", email: "  ", phone: " " });
    await user.validate();
    expect(user.loginId).toBe("player1");
    expect(user.email).toBeUndefined();
    expect(user.phone).toBeUndefined();
    user.set("phone", null);
    expect(user.phone).toBeUndefined();
    expect(User.schema.path("passwordHash").options.select).toBe(false);
  });
  it("starts a zero wallet and rejects negative, fractional and unsafe balances", async () => {
    const wallet = new Wallet({ userId });
    await wallet.validate();
    expect(wallet.availableBalancePaise).toBe(0);
    expect(wallet.reservedBalancePaise).toBe(0);
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      wallet.availableBalancePaise = value;
      await expect(wallet.validate()).rejects.toThrow();
    }
  });
  it("preserves 07 and refuses numeric selection coercion", async () => {
    const record = bet(); await record.validate();
    expect(record.selections[0].number).toBe("07");
    expect(selectionNumberSchema.safeParse(7).success).toBe(false);
    record.set("selections", [{ number: 7, stakePaise: 100 }]);
    await expect(record.validate()).rejects.toThrow();
  });
  it("rejects duplicate selections, incorrect totals and invalid metadata", async () => {
    const duplicate = bet(); duplicate.selections.push({ number: "07", stakePaise: 100 });
    await expect(duplicate.validate()).rejects.toThrow();
    const wrongTotal = bet(); wrongTotal.totalStakePaise = 200;
    await expect(wrongTotal.validate()).rejects.toThrow();
    const wrongCount = bet(); wrongCount.totalSelections = 2;
    await expect(wrongCount.validate()).rejects.toThrow();
    const wrongMetadata = bet(); wrongMetadata.entryMethod = "CROSSING";
    await expect(wrongMetadata.validate()).rejects.toThrow();
  });
  it("requires revision continuity and the correct wallet delta", async () => {
    const revision = new BetRevision({ betId: new Types.ObjectId(), userId, fromVersion: 1, toVersion: 2,
      before: composition, after: { ...composition, selections: [{ number: "07", stakePaise: 200 }], totalStakePaise: 200 },
      walletDeltaPaise: -100, editRequestId: "edit-1", editedAt: new Date() });
    await revision.validate();
    revision.walletDeltaPaise = 100; await expect(revision.validate()).rejects.toThrow();
    revision.walletDeltaPaise = -100; revision.toVersion = 4; await expect(revision.validate()).rejects.toThrow();
  });
  it("models reservations as available-to-reserved movement", async () => {
    const ledger = new WalletTransaction({ userId, walletId: new Types.ObjectId(), type: "WITHDRAWAL_RESERVED",
      amountPaise: 100, availableDeltaPaise: -100, reservedDeltaPaise: 100,
      availableBeforePaise: 200, availableAfterPaise: 100, reservedBeforePaise: 0, reservedAfterPaise: 100, idempotencyKey: "reserve-1" });
    await ledger.validate();
    ledger.reservedAfterPaise = 0; await expect(ledger.validate()).rejects.toThrow();
    ledger.reservedAfterPaise = 100; ledger.type = "BET_PLACED"; await expect(ledger.validate()).rejects.toThrow();
  });
  it("requires declaration metadata and closed-round timing", async () => {
    const round = new MarketRound({ marketId: new Types.ObjectId(), businessDate: "2026-09-06",
      opensAt: new Date("2026-09-06T01:30Z"), editCutoffAt: new Date("2026-09-06T20:30Z"), closesAt: new Date("2026-09-06T21:30Z") });
    await round.validate(); round.result = "00";
    await expect(round.validate()).rejects.toThrow();
    round.declaredByAdminId = userId; round.resultDeclaredAt = new Date("2026-09-06T21:30Z"); await round.validate();
    round.resultDeclaredAt = round.opensAt; await expect(round.validate()).rejects.toThrow();
  });
  it("requires withdrawal payment details and rejection reason", async () => {
    const withdrawal = new Withdrawal({ userId, clientRequestId: "w-1", method: "UPI", paymentDetails: { upiId: "player@bank" }, destinationSummary: "pl••@bank", amountPaise: 100, requestedAt: new Date() });
    await withdrawal.validate(); withdrawal.status = "REJECTED";
    await expect(withdrawal.validate()).rejects.toThrow();
    withdrawal.rejectionReason = "Requested details need correction"; withdrawal.decidedAt = new Date(); withdrawal.decidedByAdminId = userId;
    await withdrawal.validate();
  });
  it("registers exactly the canonical collections and critical TTL/unique indexes", () => {
    expect(models.map((model) => model.collection.collectionName)).toEqual(["users", "sessions", "otpRequests", "wallets", "walletTransactions", "markets", "marketRounds", "bets", "betRevisions", "withdrawals", "auditLogs", "platformSettings"]);
    for (const model of [Session, OtpRequest]) expect(model.schema.indexes()).toContainEqual([{ expiresAt: 1 }, { expireAfterSeconds: 0 }]);
    expect(Bet.schema.indexes()).toContainEqual([{ userId: 1, clientRequestId: 1 }, { unique: true }]);
    expect(WalletTransaction.schema.indexes()).toContainEqual([{ idempotencyKey: 1 }, { unique: true }]);
  });
});
