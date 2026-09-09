"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Wallet } from "lucide-react";
import type { WalletTransactionsPage } from "@/modules/wallet/services/wallet-transactions.service";
import type { WalletTransactionType } from "@/modules/wallet/models/wallet-transaction.model";
import type { PlayerWithdrawalsPage, WithdrawalDTO, WithdrawalReceipt, WithdrawalStatus } from "@/modules/withdrawals/services/withdrawal.service";
import { usePlayerApi } from "@/lib/ui/use-player-api";
import { useWithdrawalAction } from "@/lib/ui/use-withdrawal-action";
import { Button } from "@/components/ui/button";
import { Alert, Badge, CardSkeleton, EmptyState, ErrorState, type Tone } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { GlassCard, GlassPanel } from "@/components/ui/surface";
import { usePlayerWallet } from "./player-account";
import { BetTime } from "./bet-presentation";
import { WithdrawalForm } from "./withdrawal-form";
import { DepositPanel } from "./deposit-panel";

const transactionLabels: Record<WalletTransactionType | "DEPOSIT_CREDIT", string> = {
  DEPOSIT_CREDIT: "Deposit approved",
  BET_PLACED: "Bet placed", BET_EDIT_DEBIT: "Bet edit · additional stake", BET_EDIT_REFUND: "Bet edit · refund",
  WIN_CREDIT: "Winnings credited", WITHDRAWAL_RESERVED: "Withdrawal reserved", WITHDRAWAL_RELEASED: "Withdrawal funds released",
  WITHDRAWAL_APPROVED: "Withdrawal approved", ADMIN_CREDIT: "Manual credit", ADMIN_DEBIT: "Manual debit", MOCK_DEPOSIT: "Mock deposit",
  DEPOSIT_CREDIT: "Deposit approved",
};
const statuses: Record<WithdrawalStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "warning" }, APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" }, CANCELLED: { label: "Cancelled", tone: "neutral" },
};
function readable(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase()); }
function transactionLabel(value: string) { return Object.hasOwn(transactionLabels, value) ? transactionLabels[value as WalletTransactionType] : readable(value); }

function HistoryPages({ label, page, next, loading, onBack, onNext }: { label: string; page: number; next?: string | null; loading: boolean; onBack: () => void; onNext: (cursor: string) => void }) {
  if (page === 1 && !next) return null;
  return <nav aria-label={label} className="wallet-pagination"><Button variant="secondary" size="sm" disabled={loading || page === 1} onClick={onBack}>Newer</Button><span className="type-caption text-secondary" role="status">Page {page}</span><Button variant="secondary" size="sm" disabled={loading || !next} onClick={() => { if (next) onNext(next); }}>Older</Button></nav>;
}

export function WalletScreen() {
  const wallet = usePlayerWallet();
  const [transactionCursors, setTransactionCursors] = useState<string[]>([]);
  const [withdrawalCursors, setWithdrawalCursors] = useState<string[]>([]);
  const transactionCursor = transactionCursors.at(-1);
  const withdrawalCursor = withdrawalCursors.at(-1);
  const transactions = usePlayerApi<WalletTransactionsPage>(`/api/wallet/transactions${transactionCursor ? `?cursor=${encodeURIComponent(transactionCursor)}` : ""}`);
  const withdrawals = usePlayerApi<PlayerWithdrawalsPage>(`/api/withdrawals${withdrawalCursor ? `?cursor=${encodeURIComponent(withdrawalCursor)}` : ""}`);
  const cancel = useWithdrawalAction();
  const [cancelling, setCancelling] = useState<WithdrawalDTO>();
  const [notice, setNotice] = useState<WithdrawalReceipt>();
  const [refreshing, setRefreshing] = useState(false);
  const [depositRefresh, setDepositRefresh] = useState(0);
  const cancelHeading = useRef<HTMLHeadingElement>(null);
  const cancelOrigin = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (cancelling) cancelHeading.current?.focus(); }, [cancelling]);

  async function refreshAll() {
    setDepositRefresh(value => value + 1);
    setRefreshing(true);
    try { await Promise.all([wallet.refresh(), transactions.refresh(), withdrawals.refresh()]); }
    finally { setRefreshing(false); }
  }
  function onSuccess(receipt: WithdrawalReceipt) {
    setNotice(receipt);
    // Return to the latest pages; URL changes fetch automatically. No balances are calculated here.
    setTransactionCursors([]); setWithdrawalCursors([]);
    void refreshAll();
  }

  return <section className="stack-lg wallet-page" aria-labelledby="wallet-heading">
    <div className="section-heading"><div><p className="eyebrow">Your funds, clearly accounted for</p><h1 id="wallet-heading" className="type-page-title">Wallet</h1><p className="type-body-small text-secondary">Balances, deposits, withdrawals and a record of every movement.</p></div><div className="wallet-actions"><a className="button button--primary" href="#add-money-heading">Add Money</a><a className="button button--secondary" href="#withdrawal-request-heading">Request withdrawal</a><Button variant="secondary" loading={refreshing} onClick={() => void refreshAll()}>Refresh wallet</Button></div></div>
    {notice && <Alert tone="success" title={notice.withdrawal.status === "CANCELLED" ? "Withdrawal cancelled" : "Withdrawal request confirmed"}><Money paise={notice.withdrawal.amountPaise} /> · {notice.withdrawal.destination.summary} · {statuses[notice.withdrawal.status].label}</Alert>}
    <div className="wallet-overview-layout"><div className="stack">
      {wallet.loading ? <CardSkeleton /> : wallet.error || !wallet.data ? <ErrorState title="Balance unavailable" description={wallet.error} action={<Button onClick={() => void wallet.refresh()}>Try again</Button>} /> : <GlassCard className="wallet-summary">
        <div className="between"><p className="eyebrow">Diamond wallet · INR</p><Wallet size={22} aria-hidden="true" /></div>
        <div><p className="type-label">Available balance</p><Money paise={wallet.data.wallet.availableBalancePaise} size="large" /><p className="type-caption text-secondary">Available to play or request a withdrawal.</p></div>
        <div className="wallet-reserved"><div><p className="type-label">Reserved balance</p><Money paise={wallet.data.wallet.reservedBalancePaise} size="medium" /></div><p className="type-body-small text-secondary">Funds set aside for withdrawal requests. Cancelling an eligible pending request returns its reserved amount to available.</p></div>
      </GlassCard>}
      <GlassPanel className="stack wallet-history" aria-labelledby="transactions-heading">
        <div><h2 id="transactions-heading" className="type-section-title">Transactions</h2><p className="type-caption text-secondary">Latest first · Permanent wallet records</p></div>
        {transactions.loading ? <CardSkeleton /> : transactions.error ? <ErrorState title="Transactions unavailable" description={transactions.error} action={<Button onClick={() => void transactions.refresh()}>Try again</Button>} /> : !transactions.data?.transactions.length ? <EmptyState title="No transactions yet" description="Your wallet movements will appear here." /> : <ul className="wallet-records">{transactions.data.transactions.map(transaction => {
          const transfer = transaction.availableDeltaPaise !== 0 && transaction.reservedDeltaPaise !== 0;
          const outgoing = transaction.availableDeltaPaise < 0 || (transaction.availableDeltaPaise === 0 && transaction.reservedDeltaPaise < 0);
          const Icon = transfer ? ArrowLeftRight : outgoing ? ArrowUpRight : ArrowDownLeft;
          return <li key={transaction.id} className="wallet-transaction"><div className="wallet-record-main"><span className="wallet-movement-icon"><Icon size={18} aria-hidden="true" /></span><div><h3 className="type-label">{transactionLabel(transaction.type)}</h3><p className="type-caption text-secondary"><BetTime value={transaction.createdAt} /></p>{transaction.referenceType && <p className="type-caption text-muted">Reference type: {readable(transaction.referenceType)}</p>}</div><div className="wallet-record-amount"><Money paise={transaction.amountPaise} /><span className="type-caption text-secondary">{transfer ? "Between balances" : outgoing ? "Debit" : "Credit"}</span></div></div>
            <div className="wallet-deltas"><span>Available <Money paise={transaction.availableDeltaPaise} showPositive /></span><span>Reserved <Money paise={transaction.reservedDeltaPaise} showPositive /></span></div>
          </li>;
        })}</ul>}
        <HistoryPages label="Transaction history pages" page={transactionCursors.length + 1} next={transactions.data?.nextCursor} loading={transactions.loading} onBack={() => setTransactionCursors(current => current.slice(0, -1))} onNext={cursor => setTransactionCursors(current => [...current, cursor])} />
      </GlassPanel>
    </div><WithdrawalForm availablePaise={wallet.data?.wallet.availableBalancePaise} onSuccess={onSuccess} /></div>
    <DepositPanel refreshVersion={depositRefresh} onSuccess={() => { setTransactionCursors([]); void refreshAll(); }} />
    <GlassPanel className="stack wallet-history" aria-labelledby="withdrawals-heading">
      <div><h2 id="withdrawals-heading" tabIndex={-1} className="type-section-title">Withdrawal history</h2><p className="type-caption text-secondary">Latest first · Destinations are masked</p></div>
      {cancelling && cancel.pending && <div className="stack withdrawal-cancel" role="region" aria-label="Confirm withdrawal cancellation">
        <h3 ref={cancelHeading} tabIndex={-1} className="type-card-title">Cancel this withdrawal?</h3><p className="type-body-small"><Money paise={cancelling.amountPaise} /> · {cancelling.destination.summary}</p><p className="type-body-small text-secondary">If this request is still pending, its reserved funds will return to your available balance.</p>
        {cancel.error && <Alert tone="danger" title={cancel.uncertain ? "Confirmation pending" : "Could not cancel"}>{cancel.error}</Alert>}
        <div className="wallet-actions"><Button variant="secondary" disabled={cancel.busy || cancel.uncertain} onClick={() => { cancel.reset(); setCancelling(undefined); requestAnimationFrame(() => cancelOrigin.current?.focus()); }}>Keep withdrawal</Button><Button variant="danger" loading={cancel.busy} onClick={async () => { const receipt = await cancel.confirm(); if (receipt) { setCancelling(undefined); onSuccess(receipt); document.getElementById("withdrawals-heading")?.focus(); } else void refreshAll(); }}>{cancel.uncertain ? "Retry same cancellation" : "Confirm cancellation"}</Button></div>
      </div>}
      {withdrawals.loading ? <CardSkeleton /> : withdrawals.error ? <ErrorState title="Withdrawals unavailable" description={withdrawals.error} action={<Button onClick={() => void withdrawals.refresh()}>Try again</Button>} /> : !withdrawals.data?.withdrawals.length ? <EmptyState title="No withdrawals yet" description="Your withdrawal requests and their status will appear here." /> : <ul className="wallet-records">{withdrawals.data.withdrawals.map(withdrawal => <li key={withdrawal.id} className="withdrawal-record">
        <div className="wallet-record-main"><div><h3 className="type-card-title"><Money paise={withdrawal.amountPaise} /></h3><p className="type-body-small">{withdrawal.method === "BANK" ? "Bank account" : "UPI"} · {withdrawal.destination.summary}</p><p className="type-caption text-secondary">Requested <BetTime value={withdrawal.requestedAt} /></p>{withdrawal.decidedAt && <p className="type-caption text-secondary">{statuses[withdrawal.status].label} <BetTime value={withdrawal.decidedAt} /></p>}</div><Badge tone={statuses[withdrawal.status].tone}>{statuses[withdrawal.status].label}</Badge></div>
        {withdrawal.rejectionReason && <p className="type-body-small text-secondary">Reason: {withdrawal.rejectionReason}</p>}
        {withdrawal.status === "PENDING" && <Button variant="secondary" size="sm" disabled={!!cancel.pending} onClick={event => { cancelOrigin.current = event.currentTarget; setCancelling(withdrawal); cancel.prepare({ kind: "cancel", id: withdrawal.id }); }}>Cancel withdrawal</Button>}
      </li>)}</ul>}
      <HistoryPages label="Withdrawal history pages" page={withdrawalCursors.length + 1} next={withdrawals.data?.nextCursor} loading={withdrawals.loading} onBack={() => setWithdrawalCursors(current => current.slice(0, -1))} onNext={cursor => setWithdrawalCursors(current => [...current, cursor])} />
    </GlassPanel>
  </section>;
}
