"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { PlayerBetDetailDTO } from "@/modules/betting/services/bet-read.service";
import { usePlayerApi } from "@/lib/ui/use-player-api";
import { Button } from "@/components/ui/button";
import { Alert, CardSkeleton, ErrorState } from "@/components/ui/feedback";
import { GlassPanel } from "@/components/ui/surface";
import { Money } from "@/components/ui/money";
import { businessDateLabel } from "@/lib/ui/market-presentation";
import { usePlayerWallet } from "./player-account";
import { BetEdit } from "./bet-edit";
import { BetOutcome, BetStatus, BetTime, methodLabel, Selections, WalletDelta } from "./bet-presentation";

export function BetDetail({ reference }: { reference: string }) {
  const api = usePlayerApi<{ bet: PlayerBetDetailDTO; serverNow: string }>(`/api/bets/${encodeURIComponent(reference)}`);
  const wallet = usePlayerWallet();
  const [saved, setSaved] = useState<PlayerBetDetailDTO>();
  const [editing, setEditing] = useState<PlayerBetDetailDTO>();
  const heading = useRef<HTMLHeadingElement>(null);
  const remote = api.data?.bet;
  const bet = saved && (!remote || saved.version > remote.version) ? saved : remote;
  const savedRevision = saved?.revisions.find(r => r.toVersion === saved.version);
  function focusDetails() { requestAnimationFrame(() => heading.current?.focus()); }

  return <section className="stack bet-detail" aria-labelledby="bet-detail-heading">
    {!editing && <Link className="text-link" href="/my-bets">← My Bets</Link>}
    <h1 id="bet-detail-heading" ref={heading} tabIndex={-1} className="type-page-title">Bet detail</h1>
    {editing ? <BetEdit bet={editing} eligible={!!remote?.canEditNow && remote.version === editing.version && !api.error} onCancel={() => { setEditing(undefined); void api.refresh(); focusDetails(); }} onSaved={updated => { setSaved(updated); setEditing(undefined); void api.refresh(); void wallet.refresh(); focusDetails(); }} /> : !bet ? api.loading ? <CardSkeleton /> : <ErrorState title="Could not load this bet" description={api.error} action={<Button onClick={() => void api.refresh()}>Try again</Button>} /> : <>
      {api.error && <Alert tone="warning" title="Could not refresh this bet">{api.error}<Button variant="ghost" onClick={() => void api.refresh()}>Try again</Button></Alert>}
      {saved && <Alert tone="success" title={`Changes saved · Version ${saved.version}`}>{saved.publicRef}{savedRevision && <p><WalletDelta paise={savedRevision.walletDeltaPaise} /> · Confirmed by server</p>}</Alert>}
      <div className="bet-detail-layout"><GlassPanel className="stack">
        <div className="between"><p className="bet-reference">{bet.publicRef}</p><BetStatus status={bet.status} /></div>
        <div><h2 className="type-section-title">{bet.market.name}</h2><p className="type-body-small text-secondary">{businessDateLabel(bet.businessDate)} · Jodi game · {methodLabel(bet)}</p></div>
        <p className="type-label">{bet.totalSelections} selections · Version {bet.version}</p><Selections selections={bet.selections} />
        <dl className="bet-facts"><div><dt>Total stake</dt><dd className="bet-payable"><Money paise={bet.totalStakePaise} /></dd></div><div><dt>Multiplier snapshot</dt><dd>{bet.payoutMultiplierSnapshot}×</dd></div><BetOutcome bet={bet} /></dl>
      </GlassPanel><GlassPanel className="stack bet-detail-timing">
        <h2 className="type-card-title">Bet activity</h2><dl className="bet-facts"><div><dt>Placed</dt><dd><BetTime value={bet.placedAt} /></dd></div><div><dt>Last updated</dt><dd>{bet.lastEditedAt ? <BetTime value={bet.lastEditedAt} /> : "No edits"}</dd></div><div><dt>Edit cutoff</dt><dd><BetTime value={bet.editCutoffAt} /></dd></div>{bet.settledAt && <div><dt>Settled</dt><dd><BetTime value={bet.settledAt} /></dd></div>}</dl>
        {bet.canEditNow && !api.error ? <><p className="type-body-small text-secondary">You can update selections, stake and entry method. Availability is checked again when you save.</p><Button onClick={() => { setSaved(undefined); setEditing(bet); }}>Edit bet</Button></> : <Alert title="Editing unavailable">This bet is currently read-only. Editing requires server confirmation before the cutoff.</Alert>}
      </GlassPanel></div>
      <section className="stack" aria-labelledby="revisions-heading"><div><p className="eyebrow">Every change, preserved</p><h2 className="type-section-title" id="revisions-heading">Revision history</h2></div>
        {!bet.revisions.length ? <p className="text-secondary type-body-small">No revisions yet. This is the original bet.</p> : <ol className="bet-revisions">{[...bet.revisions].reverse().map(revision => <li key={revision.toVersion}><GlassPanel className="stack"><div className="between"><h3 className="type-card-title">Version {revision.fromVersion} → {revision.toVersion}</h3><span className="type-caption text-secondary"><BetTime value={revision.editedAt} /></span></div><p className="type-label"><WalletDelta paise={revision.walletDeltaPaise} /></p><details className="builder-disclosure"><summary>View previous and updated selections</summary><div className="revision-compositions">{([{ title: `Before · Version ${revision.fromVersion}`, value: revision.before }, { title: `After · Version ${revision.toVersion}`, value: revision.after }]).map(({ title, value }) => <div className="stack" key={title}><h4 className="type-label">{title}</h4><p className="type-body-small text-secondary">{methodLabel(value)} · {value.selections.length} selections</p><Selections selections={value.selections} /><p className="type-label">Total <Money paise={value.totalStakePaise} /></p></div>)}</div></details></GlassPanel></li>)}</ol>}
      </section>
    </>}
  </section>;
}
