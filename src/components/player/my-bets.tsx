"use client";

import { useState } from "react";
import Link from "next/link";
import type { PlayerBetsPage } from "@/modules/betting/services/bet-read.service";
import { usePlayerApi } from "@/lib/ui/use-player-api";
import { Button } from "@/components/ui/button";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/ui/feedback";
import { GlassCard } from "@/components/ui/surface";
import { Money } from "@/components/ui/money";
import { BetOutcome, BetStatus, BetTime, methodLabel } from "./bet-presentation";

export function MyBets() {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const api = usePlayerApi<PlayerBetsPage>(`/api/bets${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  return <section className="stack my-bets" aria-labelledby="my-bets-heading">
    <div className="section-heading"><div><p className="eyebrow">Your play, on record</p><h1 className="type-page-title" id="my-bets-heading">My Bets</h1><p className="type-body-small text-secondary">Selections, results and every change to your bets.</p></div><Link className="button button--secondary" href="/markets">Play a market</Link></div>
    {api.loading ? <CardSkeleton /> : api.error ? <ErrorState title="Could not load your bets" description={api.error} action={<Button onClick={() => void api.refresh()}>Try again</Button>} /> : api.data && <>
      {!api.data.bets.length ? <EmptyState title={cursor ? "No older bets" : "No bets yet"} description="Your placed bets will appear here." action={<Link className="button button--primary" href="/markets">Explore markets</Link>} /> : <ul className="my-bets-list">{api.data.bets.map(bet => <li key={bet.publicRef}><GlassCard className="my-bet-card">
        <div className="between"><Link className="text-link my-bet-reference" href={`/my-bets/${encodeURIComponent(bet.publicRef)}`}>{bet.publicRef}</Link><BetStatus status={bet.status} /></div>
        <div className="my-bet-summary"><div><h2 className="type-card-title">{bet.market.name}</h2><p className="type-body-small text-secondary">Jodi game · {methodLabel(bet)}</p><p className="type-caption text-muted">Placed <BetTime value={bet.placedAt} /></p></div><div><p className="type-caption text-secondary">Total stake</p><strong className="type-card-title"><Money paise={bet.totalStakePaise} /></strong></div></div>
        <div className="between"><p className="type-body-small text-secondary">{bet.totalSelections} selections · <span className="my-bet-numbers">{bet.selections.slice(0, 8).map(s => s.number).join(" · ")}{bet.selections.length > 8 ? " …" : ""}</span></p><Link className="text-link" href={`/my-bets/${encodeURIComponent(bet.publicRef)}`}>View bet →</Link></div>
        <dl className="bet-facts"><BetOutcome bet={bet} /></dl>
      </GlassCard></li>)}</ul>}
      <nav className="bet-review-actions" aria-label="Bet history pages"><Button variant="secondary" disabled={!cursors.length} onClick={() => setCursors(current => current.slice(0, -1))}>Newer bets</Button><span className="type-caption text-secondary" role="status">Page {cursors.length + 1}</span><Button variant="secondary" disabled={!api.data.nextCursor} onClick={() => { const next = api.data?.nextCursor; if (next) setCursors(current => [...current, next]); }}>Older bets</Button></nav>
    </>}
  </section>;
}
