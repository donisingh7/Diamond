"use client";

import { useState } from "react";
import Link from "next/link";
import type { AdminWithdrawalsPage, AdminWithdrawalDetail, AdminWithdrawalDecisionResult } from "@/modules/admin/services/admin-withdrawal.service";
import type { PlayerWithdrawalsPage } from "@/modules/withdrawals/services/withdrawal.service";
import { approveWithdrawalSchema, rejectWithdrawalSchema } from "@/modules/admin/validators/admin-ops-input";
import { useAdminApi, useAdminMutation, useAdminPage } from "@/lib/ui/use-admin-api";
import { formatINR } from "@/lib/money";
import { GlassCard, GlassPanel } from "@/components/ui/surface";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Alert } from "@/components/ui/feedback";
import { BetTime } from "@/components/player/bet-presentation";
import { AdminConfirm, Filters, FormAction, Intro, Pages, ReadState, Select, Status, formText, optionalText } from "./admin-ui";

export function AdminWithdrawals() {
  const api = useAdminPage<AdminWithdrawalsPage>("/api/admin/withdrawals", "status=PENDING");
  return <div className="stack-lg admin-operations"><Intro title="Withdrawals" description="Review pending requests and completed decisions. Payouts happen outside Diamond." /><Filters initial="status=PENDING" onApply={api.filter} fields={[{ name: "status", label: "Status", options: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] }, { name: "method", label: "Method", options: ["UPI", "BANK"] }, { name: "search", label: "Player login ID, email or phone" }]} />
    <ReadState api={api} empty={!api.data?.withdrawals.length}><ul className="admin-records">{api.data?.withdrawals.map(item => <li key={item.id}><GlassCard className="stack"><div className="between"><h2 className="type-card-title"><Money paise={item.amountPaise} /></h2><Status value={item.status} /></div><Link className="text-link" href={`/admin/players/${item.player.id}`}>{item.player.name} · {item.player.loginId}</Link><p>{item.method} · {item.destinationSummary}</p><p className="type-caption text-secondary"><BetTime value={item.requestedAt} /></p><Link className="button button--secondary" href={`/admin/withdrawals/${item.id}`}>Review withdrawal</Link></GlassCard></li>)}</ul></ReadState><Pages api={api} next={api.data?.nextCursor} />
  </div>;
}

export function AdminWithdrawal({ id }: { id: string }) {
  const api = useAdminApi<{ withdrawal: AdminWithdrawalDetail }>(`/api/admin/withdrawals/${encodeURIComponent(id)}`);
  const tx = useAdminMutation<AdminWithdrawalDecisionResult>();
  const [action, setAction] = useState("approve");
  const item = api.data?.withdrawal;
  return <div className="stack-lg admin-operations"><Link className="text-link" href="/admin/withdrawals">← Withdrawals</Link><Intro title="Withdrawal review" description="Confirm external payout before approving. No money is sent from this screen." />
    {tx.result && <Alert tone="success" title={tx.result.idempotentReplay ? "Existing decision recovered" : "Decision recorded"}><Status value={tx.result.withdrawal.status} /></Alert>}
    <ReadState api={api}>{item && <><GlassPanel className="stack"><div className="between"><h2 className="type-section-title"><Money paise={item.amountPaise} /></h2><Status value={item.status} /></div><Link className="text-link" href={`/admin/players/${item.player.id}`}>{item.player.name} · {item.player.loginId}</Link><p>{item.method} · {item.destinationSummary}</p><dl className="bet-facts"><div><dt>Requested</dt><dd><BetTime value={item.requestedAt} /></dd></div>{item.decidedAt && <div><dt>Decision time</dt><dd><BetTime value={item.decidedAt} /></dd></div>}<div><dt>Player available</dt><dd><Money paise={item.wallet.availableBalancePaise} /></dd></div><div><dt>Player reserved</dt><dd><Money paise={item.wallet.reservedBalancePaise} /></dd></div>{item.paymentReference && <div><dt>Payment reference</dt><dd>{item.paymentReference}</dd></div>}</dl>{item.rejectionReason && <p>Rejection reason: {item.rejectionReason}</p>}{item.decisionNote && <p>Decision note: {item.decisionNote}</p>}</GlassPanel>
      {item.status === "PENDING" && !tx.result ? <GlassPanel className="stack"><h2 className="type-section-title">Record a decision</h2><Select label="Action" value={action} onChange={event => setAction(event.target.value)} disabled={!!tx.job}><option value="approve">Mark Paid & Approve</option><option value="reject">Reject withdrawal</option></Select>
        <FormAction key={action} disabled={!!tx.job} label={action === "approve" ? "Mark Paid & Approve" : "Review rejection"} prepare={tx.prepare} build={data => {
          const common = { clientRequestId: crypto.randomUUID(), ...optionalText(data, "note") };
          const body = action === "approve" ? approveWithdrawalSchema.parse({ ...common, confirmPaid: data.get("confirmPaid") === "on", ...optionalText(data, "paymentReference") }) : rejectWithdrawalSchema.parse({ ...common, reason: formText(data, "reason") });
          return { url: `/api/admin/withdrawals/${id}/${action}`, body, replaySafe: true, destructive: action === "reject", title: action === "approve" ? "Mark Paid & Approve" : "Reject withdrawal", description: `${item.player.name} · ${item.player.loginId}\n${formatINR(item.amountPaise)} · ${item.destinationSummary}\n${action === "approve" ? "Confirm the external payout has already been completed. This records payment and finalizes reserved funds; it does not send a payment." : `Reason: ${formText(data, "reason")}\nReserved funds will return to the player’s available balance.`}`, confirmLabel: action === "approve" ? "Mark Paid & Approve" : "Confirm rejection" };
        }}>{action === "approve" ? <><Alert tone="warning" title="Pay externally first">Complete and verify the bank or UPI payout before marking this request paid.</Alert><label className="admin-check"><input type="checkbox" name="confirmPaid" required />I confirm the external payout is complete.</label><Input name="paymentReference" label="Payment reference (optional)" maxLength={200} /></> : <Input name="reason" label="Rejection reason" required maxLength={500} />}<Input name="note" label="Decision note (optional)" maxLength={500} /></FormAction>
      </GlassPanel> : <Alert title="Decision is read-only">This withdrawal cannot be approved or rejected again from this screen.</Alert>}
    </>}</ReadState><AdminConfirm tx={tx} onSuccess={() => void api.refresh()} />
  </div>;
}

export function AdminPlayerWithdrawals({ id }: { id: string }) {
  const api = useAdminPage<PlayerWithdrawalsPage>(`/api/admin/players/${encodeURIComponent(id)}/withdrawals`);
  return <div className="stack-lg admin-operations"><Link className="text-link" href={`/admin/players/${id}`}>← Player detail</Link><Intro title="Player withdrawals" description="Masked destinations and the server’s latest status." /><ReadState api={api} empty={!api.data?.withdrawals.length}><ul className="admin-records">{api.data?.withdrawals.map(item => <li key={item.id}><GlassCard className="stack"><div className="between"><Money paise={item.amountPaise} /><Status value={item.status} /></div><p>{item.method} · {item.destination.summary}</p><BetTime value={item.requestedAt} /><Link className="text-link" href={`/admin/withdrawals/${item.id}`}>Review withdrawal →</Link></GlassCard></li>)}</ul></ReadState><Pages api={api} next={api.data?.nextCursor} /></div>;
}
