"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePlayerApi } from "@/lib/ui/use-player-api";
import { useDepositAction } from "@/lib/ui/use-deposit-action";
import { depositSubmission, positiveAmount, type Deposit, type DepositPage, type PlayerPaymentMethod } from "@/lib/ui/deposit-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, CardSkeleton, EmptyState, ErrorState } from "@/components/ui/feedback";
import { GlassPanel } from "@/components/ui/surface";
import { Money } from "@/components/ui/money";
import { DepositRecord, PaymentDetails, PaymentUpload } from "@/components/shared/payment-presentation";

function AddMoneyForm({ onSuccess }: { onSuccess: () => void }) {
  const methods = usePlayerApi<{ paymentMethods: PlayerPaymentMethod[] }>("/api/deposits/payment-methods");
  const tx = useDepositAction();
  const [payment, setPayment] = useState<{ method: PlayerPaymentMethod; amount: number }>();
  const [proofId, setProofId] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [receipt, setReceipt] = useState<Deposit>();
  const heading = useRef<HTMLHeadingElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (payment || tx.pending || receipt) heading.current?.focus(); }, [payment, tx.pending, receipt]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  function choose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const data = new FormData(event.currentTarget);
      const method = methods.data?.paymentMethods.find(item => item.id === data.get("method"));
      if (!method) throw new Error("Choose an available payment method.");
      setPayment({ method, amount: positiveAmount(String(data.get("amount") ?? "")) }); setError(undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Check the payment details."); }
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment || uploading) return;
    if (!proofId) { setError("Upload your payment screenshot before submitting."); return; }
    const data = new FormData(event.currentTarget);
    const parsed = depositSubmission.safeParse({ paymentMethodId: payment.method.id, requestedAmountPaise: payment.amount, proofImageId: proofId, utr: data.get("utr"), clientRequestId: crypto.randomUUID() });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(" ")); return; }
    setError(undefined); tx.prepare(parsed.data);
  }
  return <GlassPanel className="stack deposit-form" aria-busy={tx.busy || uploading}>
    <div><p className="eyebrow">Add funds to your wallet</p><h2 id="add-money-heading" ref={heading} tabIndex={-1} className="type-section-title">{receipt ? "Deposit submitted" : tx.pending ? "Review deposit" : "Add Money"}</h2></div>
    <Alert tone="warning" title="Payment is verified manually by Admin">Pay externally using the payment details below. Submitting proof does not instantly credit your wallet.</Alert>
    {error && <div ref={errorBox} tabIndex={-1}><Alert tone="danger" title="Check your payment details">{error}</Alert></div>}
    {receipt ? <><Alert tone="success" title="Request recorded">Your deposit is {receipt.status.toLowerCase()}. Track the decision in deposit history.</Alert><DepositRecord deposit={receipt} /><Button variant="secondary" onClick={() => { setReceipt(undefined); setPayment(undefined); setProofId(undefined); tx.reset(); void methods.refresh(); }}>Add another payment</Button></> : !payment ? <>
      {methods.loading ? <CardSkeleton /> : methods.error ? <ErrorState title="Payment methods unavailable" description={methods.error} action={<Button onClick={() => void methods.refresh()}>Try again</Button>} /> : !methods.data?.paymentMethods.length ? <EmptyState title="No payment methods available" description="An Admin must activate a payment method before you can add money." action={<Button variant="secondary" onClick={() => void methods.refresh()}>Refresh methods</Button>} /> : <form className="stack" onSubmit={choose}>
        <Input label="Amount (₹)" name="amount" inputMode="decimal" autoComplete="off" placeholder="e.g. 500" maxLength={32} required />
        <fieldset className="payment-options"><legend className="type-label">Choose a payment method</legend>{methods.data.paymentMethods.map(method => <label key={method.id}><input type="radio" name="method" value={method.id} required /><span><strong>{method.displayName}</strong><small>{method.type === "UPI" ? "UPI" : "Bank transfer"}</small></span></label>)}</fieldset>
        <Button type="submit">Continue to payment details</Button>
      </form>}
    </> : <>
      <div className="withdrawal-available"><span className="type-label">Requested amount</span><Money paise={payment.amount} /></div>
      <PaymentDetails method={payment.method} copyable />
      <p className="type-body-small text-secondary">Pay this amount externally, then upload the completed payment screenshot and enter its UTR / reference. Keep this page open.</p>
      <form className="stack" onSubmit={review} hidden={!!tx.pending}>
        <PaymentUpload kind="proof" imageId={proofId} onChange={setProofId} onBusy={setUploading} disabled={!!tx.pending} />
        <Input label="UTR / payment reference" name="utr" minLength={4} maxLength={64} required autoComplete="off" spellCheck={false} helperText="Use the reference from your completed transfer." />
        <div className="wallet-actions"><Button variant="secondary" disabled={uploading} onClick={() => { setPayment(undefined); setProofId(undefined); setError(undefined); }}>Change amount or method</Button><Button type="submit" disabled={uploading || !proofId}>Review deposit</Button></div>
      </form>
      {tx.pending && <div className="stack"><p className="type-body-small payment-instructions">UTR / reference: <strong>{tx.pending.utr}</strong></p><p className="type-caption text-secondary">Your uploaded screenshot will be shared with Admin for verification.</p>
        {tx.error && <Alert tone="danger" title={tx.uncertain ? "Confirmation pending" : "Deposit not submitted"}>{tx.error}</Alert>}
        <div className="wallet-actions"><Button variant="secondary" disabled={tx.busy || tx.uncertain} onClick={tx.reset}>Change proof or UTR</Button><Button loading={tx.busy} onClick={async () => { const deposit = await tx.confirm(); if (deposit) { setReceipt(deposit); onSuccess(); } }}>{tx.uncertain ? "Retry same request" : "Submit deposit for verification"}</Button></div>
      </div>}
    </>}
  </GlassPanel>;
}

export function DepositPanel({ onSuccess, refreshVersion }: { onSuccess: () => void; refreshVersion: number }) {
  const [status, setStatus] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  return <div className="deposit-layout">
    <AddMoneyForm onSuccess={() => { setStatus(""); setCursors([]); setVersion(value => value + 1); onSuccess(); }} />
    <DepositHistory key={`${version}-${refreshVersion}`} status={status} cursors={cursors} onStatus={value => { setStatus(value); setCursors([]); }} onCursors={setCursors} />
  </div>;
}
function DepositHistory({ status, cursors, onStatus, onCursors }: { status: string; cursors: string[]; onStatus: (value: string) => void; onCursors: (value: string[]) => void }) {
  const query = new URLSearchParams(); if (status) query.set("status", status); if (cursors.at(-1)) query.set("cursor", cursors.at(-1)!);
  const api = usePlayerApi<DepositPage>(`/api/deposits?${query}`);
  return <GlassPanel className="stack wallet-history"><div><h2 className="type-section-title">Deposit history</h2><p className="type-caption text-secondary">Latest first · Amounts reflect the Admin decision</p></div>
    <label className="field admin-select"><span className="type-label">Deposit status</span><select value={status} onChange={event => onStatus(event.target.value)}><option value="">All deposits</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></label>
    {api.loading ? <CardSkeleton /> : api.error ? <ErrorState title="Deposit history unavailable" description={api.error} action={<Button onClick={() => void api.refresh()}>Try again</Button>} /> : !api.data?.deposits.length ? <EmptyState title="No deposits to show" description="Submitted payments will appear here with their verification status." /> : <ul className="wallet-records">{api.data.deposits.map(item => <li key={item.id}><DepositRecord deposit={item} /><details className="admin-disclosure"><summary>Payment method at submission</summary><PaymentDetails method={item.paymentMethodSnapshot} /></details></li>)}</ul>}
    {(cursors.length > 0 || api.data?.nextCursor) && <nav className="wallet-pagination" aria-label="Deposit history pages"><Button size="sm" variant="secondary" disabled={api.loading || !cursors.length} onClick={() => onCursors(cursors.slice(0, -1))}>Newer</Button><span className="type-caption" role="status">Page {cursors.length + 1}</span><Button size="sm" variant="secondary" disabled={api.loading || !api.data?.nextCursor} onClick={() => { if (api.data?.nextCursor) onCursors([...cursors, api.data.nextCursor]); }}>Older</Button></nav>}
  </GlassPanel>;
}
