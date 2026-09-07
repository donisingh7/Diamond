"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { buildDestinationSummary, createWithdrawalSchema } from "@/modules/withdrawals/validators/withdrawal-input";
import type { WithdrawalReceipt } from "@/modules/withdrawals/services/withdrawal.service";
import { rupeesToPaise } from "@/lib/money";
import { useWithdrawalAction } from "@/lib/ui/use-withdrawal-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { GlassPanel } from "@/components/ui/surface";

export function WithdrawalForm({ availablePaise, onSuccess }: { availablePaise?: number; onSuccess: (receipt: WithdrawalReceipt) => void }) {
  const [method, setMethod] = useState<"UPI" | "BANK">("UPI");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const tx = useWithdrawalAction();
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const pending = tx.pending?.kind === "request" ? tx.pending.request : undefined;
  useEffect(() => { if (pending || success) heading.current?.focus(); }, [pending, success]);
  useEffect(() => { if (Object.keys(errors).length) form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(); }, [errors]);

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "");
    let amountPaise: number;
    try { amountPaise = rupeesToPaise(value("amount")); }
    catch { setErrors({ amount: "Enter a valid rupee amount with up to two decimal places." }); return; }
    if (amountPaise <= 0) { setErrors({ amount: "Enter an amount greater than zero." }); return; }
    const parsed = createWithdrawalSchema.safeParse({
      method, amountPaise, clientRequestId: crypto.randomUUID(),
      ...(method === "UPI" ? { upi: { upiId: value("upiId") } } : { bank: {
        accountHolderName: value("accountHolderName"), accountNumber: value("accountNumber"),
        confirmAccountNumber: value("confirmAccountNumber"), ifsc: value("ifsc"),
        ...(value("bankName").trim() ? { bankName: value("bankName") } : {}),
      } }),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path.at(-1))] ??= issue.message;
      setErrors(next); return;
    }
    setErrors({}); tx.prepare({ kind: "request", request: parsed.data });
  }

  return <GlassPanel className="stack withdrawal-form" aria-busy={tx.busy}>
    <div><p className="eyebrow">Move your funds</p><h2 id="withdrawal-request-heading" ref={heading} tabIndex={-1} className="type-section-title">{success ? "Request confirmed" : pending ? "Review withdrawal" : "Request a withdrawal"}</h2></div>
    {success ? <><p className="type-body-small text-secondary">Your request is recorded. Check withdrawal history below for its current status.</p><Button variant="secondary" onClick={() => { setSuccess(false); tx.reset(); }}>Make another request</Button></> : <>
      <div className="withdrawal-available"><span className="type-body-small text-secondary">Current available balance</span>{availablePaise === undefined ? <span className="type-body-small">Unavailable</span> : <Money paise={availablePaise} />}</div>
      <form ref={form} onSubmit={review} className="stack" hidden={!!pending} noValidate>
        <fieldset className="withdrawal-method"><legend className="type-label">Withdrawal method</legend>{(["UPI", "BANK"] as const).map(option => <label key={option}><input type="radio" name="method" value={option} checked={method === option} onChange={() => { setMethod(option); setErrors({}); }} />{option === "BANK" ? "Bank account" : "UPI"}</label>)}</fieldset>
        <Input label="Amount (₹)" name="amount" inputMode="decimal" placeholder="e.g. 500" autoComplete="off" maxLength={32} required error={errors.amount} />
        <div key={method} className="stack">{method === "UPI" ? <Input label="UPI ID" name="upiId" placeholder="name@bank" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={256} required error={errors.upiId} /> : <>
          <Input label="Account holder name" name="accountHolderName" autoComplete="off" maxLength={140} required error={errors.accountHolderName} />
          <Input label="Account number" name="accountNumber" inputMode="numeric" autoComplete="off" maxLength={20} required error={errors.accountNumber} />
          <Input label="Confirm account number" name="confirmAccountNumber" inputMode="numeric" autoComplete="off" maxLength={20} required error={errors.confirmAccountNumber} />
          <Input label="IFSC" name="ifsc" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={11} placeholder="e.g. ABCD0123456" required error={errors.ifsc} />
          <Input label="Bank name (optional)" name="bankName" autoComplete="off" maxLength={140} error={errors.bankName} />
        </>}</div>
        {Object.keys(errors).length > 0 && <Alert tone="danger" title="Check your withdrawal details">Correct the highlighted fields before continuing.</Alert>}
        <p className="type-caption text-secondary">Your available balance and withdrawal amount are checked when you confirm.</p>
        <Button type="submit" disabled={availablePaise === undefined}>Review withdrawal</Button>
      </form>
      {pending && <div className="stack">
        <dl className="bet-facts"><div><dt>Requested amount</dt><dd className="bet-payable"><Money paise={pending.amountPaise} /></dd></div><div><dt>Method</dt><dd>{pending.method === "BANK" ? "Bank account" : "UPI"}</dd></div><div><dt>Destination</dt><dd>{buildDestinationSummary(pending)}</dd></div></dl>
        <p className="type-body-small text-secondary">On confirmation, this amount moves from available to reserved while your request is pending.</p>
        {tx.error && <Alert tone="danger" title={tx.uncertain ? "Confirmation pending" : "Withdrawal not requested"}>{tx.error}</Alert>}
        <div className="wallet-actions"><Button variant="secondary" disabled={tx.busy || tx.uncertain} onClick={() => { tx.reset(); requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('[name="amount"]')?.focus()); }}>Change details</Button><Button loading={tx.busy} disabled={!tx.uncertain && availablePaise === undefined} onClick={async () => { const receipt = await tx.confirm(); if (receipt) { form.current?.reset(); setSuccess(true); onSuccess(receipt); } }}>{tx.uncertain ? "Retry same request" : "Confirm withdrawal"}</Button></div>
      </div>}
    </>}
  </GlassPanel>;
}
