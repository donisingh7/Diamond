"use client";

import Link from "next/link";
import type { AdminBetsPage, AdminBetDetailDTO } from "@/modules/admin/services/admin-bet.service";
import { useAdminApi, useAdminPage } from "@/lib/ui/use-admin-api";
import { GlassCard, GlassPanel } from "@/components/ui/surface";
import { Money } from "@/components/ui/money";
import { BetOutcome, BetTime, Selections, WalletDelta, methodLabel } from "@/components/player/bet-presentation";
import { Filters, Intro, Pages, ReadState, Status } from "./admin-ui";

export function AdminBets({ playerId }: { playerId?: string }) {
  const api = useAdminPage<AdminBetsPage>("/api/admin/bets", playerId ? `playerId=${encodeURIComponent(playerId)}` : "");
  return <div className="stack-lg admin-operations"><Intro title="Bets" description="Read-only wagers and revision history. Admins cannot edit player bets." /><Filters fields={[{ name: "market", label: "Market slug" }, { name: "status", label: "Status", options: ["ACTIVE", "WON", "LOST"] }, { name: "entryMethod", label: "Entry method", options: ["JODI", "CROSSING", "COPY_PASTE"] }, { name: "businessDate", label: "Business date", type: "date" }]} onApply={query => api.filter(`${query}${playerId ? `&playerId=${encodeURIComponent(playerId)}` : ""}`)} />
    <ReadState api={api} empty={!api.data?.bets.length}><ul className="admin-records">{api.data?.bets.map(bet => <li key={bet.id}><GlassCard className="stack"><div className="between"><Link className="text-link admin-reference" href={`/admin/bets/${encodeURIComponent(bet.publicRef)}`}>{bet.publicRef}</Link><Status value={bet.status} /></div><h2 className="type-card-title">{bet.market.name}</h2><Link className="text-link" href={`/admin/players/${bet.player.id}`}>{bet.player.name} · {bet.player.loginId}</Link><p>{methodLabel(bet)} · {bet.totalSelections} selections</p><div className="between"><Money paise={bet.totalStakePaise} /><span>{bet.payoutMultiplierSnapshot}×</span></div><p className="type-caption text-secondary"><BetTime value={bet.placedAt} /></p></GlassCard></li>)}</ul></ReadState><Pages api={api} next={api.data?.nextCursor} />
  </div>;
}
export function AdminBet({ reference }: { reference: string }) {
  const api = useAdminApi<{ bet: AdminBetDetailDTO }>(`/api/admin/bets/${encodeURIComponent(reference)}`);
  const bet = api.data?.bet;
  return <div className="stack-lg admin-operations"><Link className="text-link" href="/admin/bets">← Bets</Link><Intro title="Bet detail" description="Original snapshots and revisions are read-only." /><ReadState api={api}>{bet && <>
    <GlassPanel className="stack"><div className="between"><h2 className="type-section-title admin-reference">{bet.publicRef}</h2><Status value={bet.status} /></div><h3 className="type-card-title">{bet.market.name} · {bet.businessDate}</h3><Link className="text-link" href={`/admin/players/${bet.player.id}`}>{bet.player.name} · {bet.player.loginId}</Link><p>{methodLabel(bet)} · Version {bet.version} · {bet.totalSelections} selections</p><Selections selections={bet.selections} /><dl className="bet-facts"><div><dt>Total stake</dt><dd><Money paise={bet.totalStakePaise} /></dd></div><div><dt>Multiplier snapshot</dt><dd>{bet.payoutMultiplierSnapshot}×</dd></div><div><dt>Placed</dt><dd><BetTime value={bet.placedAt} /></dd></div>{bet.lastEditedAt && <div><dt>Updated</dt><dd><BetTime value={bet.lastEditedAt} /></dd></div>}<BetOutcome bet={bet} /></dl></GlassPanel>
    <h2 className="type-section-title">Revisions</h2>{!bet.revisions.length ? <p className="text-secondary">No revisions. This is the original bet.</p> : [...bet.revisions].reverse().map(revision => <GlassPanel key={revision.toVersion} className="stack"><div className="between"><h3 className="type-card-title">Version {revision.fromVersion} → {revision.toVersion}</h3><BetTime value={revision.editedAt} /></div><WalletDelta paise={revision.walletDeltaPaise} /><div className="admin-form-grid">{[{ title: "Before", composition: revision.before }, { title: "After", composition: revision.after }].map(({ title, composition }) => <details key={title} className="admin-disclosure"><summary>{title} · {methodLabel(composition)} · <Money paise={composition.totalStakePaise} /></summary><Selections selections={composition.selections} /></details>)}</div></GlassPanel>)}
  </>}</ReadState></div>;
}
