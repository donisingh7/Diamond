"use client";

import Link from "next/link";
import type { AdminDashboard } from "@/modules/admin/services/admin-dashboard.service";
import type { AdminAuditLogDTO, AdminAuditLogsPage } from "@/modules/admin/services/admin-audit.service";
import type { PayoutRateView, UpdatePayoutRateResult } from "@/modules/admin/services/admin-settings.service";
import { updatePayoutRateSchema } from "@/modules/admin/validators/admin-ops-input";
import { useAdminApi, useAdminMutation, useAdminPage } from "@/lib/ui/use-admin-api";
import { GlassCard, GlassPanel } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Alert } from "@/components/ui/feedback";
import { BetTime } from "@/components/player/bet-presentation";
import { AdminConfirm, Filters, FormAction, Intro, Pages, ReadState, Snapshot, Status, formText, label } from "./admin-ui";

function AuditRows({ logs }: { logs: AdminAuditLogDTO[] }) {
  return <ul className="wallet-records">{logs.map(log => <li key={log.id} className="stack"><div className="between"><h3 className="type-label">{label(log.action)}</h3><span className="type-caption text-secondary"><BetTime value={log.createdAt} /></span></div><p className="type-caption text-secondary">{log.entityType} · Admin {log.actorAdminId}</p>{log.subjectUserId && <Link className="text-link" href={`/admin/players/${log.subjectUserId}`}>Related player</Link>}<details className="admin-disclosure"><summary>Event details</summary><p className="type-caption text-muted">Entity reference: {log.entityId ?? "None"}</p><div className="admin-form-grid"><div><h4 className="type-label">Before</h4><Snapshot value={log.before} /></div><div><h4 className="type-label">After</h4><Snapshot value={log.after} /></div></div></details></li>)}</ul>;
}
export function AdminOverview() {
  const api = useAdminApi<AdminDashboard>("/api/admin/dashboard");
  const data = api.data;
  return <div className="stack-lg admin-operations"><Intro title="Dashboard" description="Current operations and today’s activity, calculated by the server."><Button variant="secondary" onClick={() => void api.refresh()}>Refresh summary</Button></Intro><ReadState api={api}>{data && <>
    <div className="admin-metrics"><GlassCard className="admin-metric admin-metric--priority"><p className="eyebrow">Pending withdrawals</p><strong>{data.withdrawals.pendingCount}</strong><Money paise={data.withdrawals.pendingAmountPaise} /><Link className="text-link" href="/admin/withdrawals">Review requests →</Link></GlassCard><GlassCard className="admin-metric"><p className="eyebrow">Today’s bets · IST</p><strong>{data.betsToday.count}</strong><Money paise={data.betsToday.totalStakePaise} /><Link className="text-link" href="/admin/bets">Browse bets →</Link></GlassCard><GlassCard className="admin-metric"><p className="eyebrow">Players</p><strong>{data.players.total}</strong><p className="type-caption">{data.players.active} active · {data.players.disabled} disabled</p><Link className="text-link" href="/admin/players">Manage players →</Link></GlassCard><GlassCard className="admin-metric"><p className="eyebrow">Round results</p><strong>{data.results.pending}</strong><p className="type-caption">Pending · {data.results.declared} declared</p><Link className="text-link" href="/admin/results">Open results →</Link></GlassCard></div>
    <GlassPanel><div className="admin-form-grid"><div><p className="type-label">Total player available funds</p><Money size="medium" paise={data.wallet.totalAvailablePaise} /></div><div><p className="type-label">Total player reserved funds</p><Money size="medium" paise={data.wallet.totalReservedPaise} /></div></div></GlassPanel>
    <GlassPanel className="stack"><div className="between"><h2 className="type-section-title">Market operations</h2><Link className="text-link" href="/admin/markets">Manage markets →</Link></div><ul className="wallet-records">{data.markets.map(market => <li key={market.slug}><div className="between"><h3 className="type-card-title">{market.name}</h3><Status value={market.state} /></div><p className="type-caption text-secondary">{market.businessDate} · Result {market.result ?? "pending"}{!market.enabled ? " · Disabled" : ""}</p>{market.closesAt && <p className="type-caption">Closes <BetTime value={market.closesAt} /></p>}</li>)}</ul>{!data.markets.length && <p className="text-secondary">No markets returned.</p>}</GlassPanel>
    <GlassPanel className="stack"><div className="between"><h2 className="type-section-title">Recent admin activity</h2><Link className="text-link" href="/admin/audit">Open audit log →</Link></div>{data.recentActivity.length ? <AuditRows logs={data.recentActivity} /> : <p className="text-secondary">No recent activity.</p>}</GlassPanel><p className="type-caption text-muted">Server snapshot <BetTime value={data.serverNow} /></p>
  </>}</ReadState></div>;
}
export function AdminAudit() {
  const api = useAdminPage<AdminAuditLogsPage>("/api/admin/audit");
  return <div className="stack-lg admin-operations"><Intro title="Audit log" description="Read-only operational records and before/after snapshots." /><Filters onApply={api.filter} fields={[{ name: "action", label: "Action", placeholder: "e.g. RESULT_DECLARED" }, { name: "entityType", label: "Entity type", placeholder: "e.g. MarketRound" }, { name: "actorAdminId", label: "Admin ID" }, { name: "subjectUserId", label: "Player ID" }, { name: "dateFrom", label: "From", type: "date" }, { name: "dateTo", label: "To", type: "date" }]} /><GlassPanel><ReadState api={api} empty={!api.data?.logs.length}>{api.data && <AuditRows logs={api.data.logs} />}</ReadState></GlassPanel><Pages api={api} next={api.data?.nextCursor} /></div>;
}
export function AdminRate() {
  const api = useAdminApi<PayoutRateView>("/api/admin/settings/rate");
  const tx = useAdminMutation<UpdatePayoutRateResult>();
  return <div className="stack-lg admin-operations"><Intro title="Payout rate" description="Changes apply to future bets. Historical bet multiplier snapshots remain unchanged." />{tx.result && <Alert tone="success" title={tx.result.changed ? "Payout rate updated" : "Rate unchanged"}>Current rate: {tx.result.payoutMultiplier}×</Alert>}<ReadState api={api}>{api.data && <GlassPanel className="stack admin-narrow"><h2 className="type-section-title">Current rate · {api.data.payoutMultiplier}×</h2><p className="type-body-small text-secondary">Currency: {api.data.currency} · Minimum stake: <Money paise={api.data.minimumStakePaise} /></p><FormAction key={api.data.payoutMultiplier} disabled={!!tx.job} prepare={tx.prepare} build={data => { const body = updatePayoutRateSchema.parse({ payoutMultiplier: Number(formText(data, "payoutMultiplier")) }); return { url: "/api/admin/settings/rate", body, title: "Update future payout rate", description: `${api.data?.payoutMultiplier}× → ${body.payoutMultiplier}×\nOnly bets placed after this update receive the new multiplier. Historical snapshots remain unchanged.`, confirmLabel: "Update payout rate" }; }}><Input label="New payout multiplier" name="payoutMultiplier" type="number" min={1} max={1000} step={1} defaultValue={api.data.payoutMultiplier} required /></FormAction></GlassPanel>}</ReadState><AdminConfirm tx={tx} onSuccess={() => void api.refresh()} /></div>;
}
