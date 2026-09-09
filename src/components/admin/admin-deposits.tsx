"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminPlayerDetail } from "@/modules/admin/services/admin-player.service";
import { useAdminApi, useAdminMutation, useAdminPage } from "@/lib/ui/use-admin-api";
import { approvalInput, positiveAmount, rejectionInput, type AdminDeposit, type DepositPage } from "@/lib/ui/deposit-contract";
import { formatINR, paiseToRupees } from "@/lib/money";
import { GlassCard, GlassPanel } from "@/components/ui/surface";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { DepositAmounts, DepositRecord, PaymentDetails, PaymentImage } from "@/components/shared/payment-presentation";
import { AdminConfirm, Filters, FormAction, Intro, Pages, ReadState, Select, formText } from "./admin-ui";

export function AdminDeposits() {
  const api = useAdminPage<DepositPage<AdminDeposit>>("/api/admin/deposits", "status=PENDING");
  return <div className="stack-lg admin-operations"><Intro title="Deposits" description="Verify external payments and record the amount to credit. Every decision is permanent." />
    <Filters initial="status=PENDING" fields={[{ name: "status", label: "Status", options: ["PENDING", "APPROVED", "REJECTED"] }]} onApply={api.filter} />
    <ReadState api={api} empty={!api.data?.deposits.length}><ul className="admin-records">{api.data?.deposits.map(item => <li key={item.id}><GlassCard className="stack"><DepositRecord deposit={item} /><Link className="text-link" href={`/admin/players/${item.userId}`}>View player profile</Link><Link className="button button--secondary" href={`/admin/deposits/${item.id}`}>Review deposit</Link></GlassCard></li>)}</ul></ReadState><Pages api={api} next={api.data?.nextCursor} />
  </div>;
}
export function AdminDepositDetail({ id }: { id: string }) {
  const api = useAdminApi<{ deposit: AdminDeposit }>(`/api/admin/deposits/${encodeURIComponent(id)}`);
  return <div className="stack-lg admin-operations"><Link className="text-link" href="/admin/deposits">← Deposits</Link><Intro title="Deposit review" description="Match the transfer, UTR and screenshot to the actual payment received before making a decision." />
    <ReadState api={api}>{api.data && <DepositReview key={api.data.deposit.id} deposit={api.data.deposit} refresh={api.refresh} />}</ReadState>
  </div>;
}
function DepositReview({ deposit, refresh }: { deposit: AdminDeposit; refresh: () => Promise<void> }) {
  const player = useAdminApi<{ player: AdminPlayerDetail }>(`/api/admin/players/${encodeURIComponent(deposit.userId)}`);
  const tx = useAdminMutation<{ deposit: AdminDeposit }>();
  const [action, setAction] = useState("approve");
  const [approved, setApproved] = useState(paiseToRupees(deposit.requestedAmountPaise));
  const item = tx.result?.deposit ?? deposit;
  let preview: number | null = null;
  try { preview = positiveAmount(approved); } catch { /* Incomplete input has no monetary preview. */ }
  const changed = preview !== null && preview !== item.requestedAmountPaise;
  const person = player.data?.player;
  return <>
    {tx.result && <Alert tone="success" title="Server decision recorded">The deposit is {item.status.toLowerCase()}. The amounts and status below are the confirmed server record.</Alert>}
    <div className="deposit-layout"><GlassPanel className="stack"><DepositRecord deposit={item} fullUtr />
      <ReadState api={player}>{person && <div className="stack"><Link className="text-link" href={`/admin/players/${person.id}`}>{person.name} · {person.loginId}</Link><dl className="bet-facts"><div><dt>Available balance</dt><dd><Money paise={person.wallet.availableBalancePaise} /></dd></div><div><dt>Reserved balance</dt><dd><Money paise={person.wallet.reservedBalancePaise} /></dd></div></dl></div>}</ReadState>
      {!person && <Link className="text-link" href={`/admin/players/${item.userId}`}>View submitting player</Link>}
      <details className="admin-disclosure" open><summary>Payment method at submission</summary><PaymentDetails method={item.paymentMethodSnapshot} /></details>
    </GlassPanel><GlassPanel className="stack"><h2 className="type-section-title">Payment proof</h2><p className="type-caption text-secondary">Open the image to inspect it at full size. A screenshot alone does not confirm receipt.</p><PaymentImage key={item.proofImageId} src={`/api/deposits/proof/${encodeURIComponent(item.proofImageId)}`} alt="Player payment screenshot" /></GlassPanel></div>
    {item.status === "PENDING" ? <GlassPanel className="stack admin-narrow"><h2 className="type-section-title">Record a decision</h2>
      <Select label="Decision" value={action} disabled={!!tx.job} onChange={event => setAction(event.target.value)}><option value="approve">Approve and credit wallet</option><option value="reject">Reject deposit</option></Select>
      <FormAction key={action} disabled={!!tx.job} label={action === "approve" ? "Review approval" : "Review rejection"} prepare={tx.prepare} build={data => {
        const clientRequestId = crypto.randomUUID();
        const remark = formText(data, "adminRemark");
        const body = action === "approve" ? approvalInput(approved, item.requestedAmountPaise, remark, clientRequestId) : rejectionInput.parse({ adminRemark: remark, clientRequestId });
        const amount = "approvedAmountPaise" in body ? body.approvedAmountPaise : null;
        const difference = amount === null ? 0 : amount - item.requestedAmountPaise;
        return { url: `/api/admin/deposits/${encodeURIComponent(item.id)}/${action}`, body, replaySafe: true, destructive: action === "reject",
          title: action === "approve" ? "Approve deposit and credit wallet?" : "Reject deposit?",
          description: `${person ? `${person.name} · ${person.loginId}\n` : ""}UTR: ${item.utr}\nRequested: ${formatINR(item.requestedAmountPaise)}\n${amount === null ? "No wallet credit will be made." : `Approved: ${formatINR(amount)}\nDifference: ${difference < 0 ? "−" : difference > 0 ? "+" : ""}${formatINR(Math.abs(difference))}\nConfirm you verified the external payment. The server will credit the approved amount once.`}\n${remark ? `Admin remark: ${remark}\n` : ""}This decision cannot be changed here.`,
          confirmLabel: action === "approve" ? "Approve & credit wallet" : "Confirm rejection" };
      }}>
        {action === "approve" ? <><Alert tone="warning" title="Verify the money received">The approved amount may be equal to, lower than or higher than requested. Enter the amount you have verified.</Alert>
          <Input name="approvedAmount" label="Approved Amount (₹)" value={approved} onChange={event => setApproved(event.target.value)} inputMode="decimal" required maxLength={32} />
          <div aria-live="polite"><DepositAmounts requested={item.requestedAmountPaise} approved={preview} /></div>
        </> : <Alert tone="warning" title="Reject without credit">The player will see your remark. This deposit cannot be approved after rejection.</Alert>}
        <label className="field payment-textarea"><span className="type-label">Admin Remark {action === "reject" || changed ? "(required)" : "(optional)"}</span><textarea name="adminRemark" required={action === "reject" || changed} maxLength={1000} rows={4} /></label>
      </FormAction>
    </GlassPanel> : <Alert title="Decision is read-only">This deposit has been {item.status.toLowerCase()}. Its original requested amount and payment details are preserved.</Alert>}
    <AdminConfirm tx={tx} onSuccess={() => { void refresh(); void player.refresh(); }} />
  </>;
}
