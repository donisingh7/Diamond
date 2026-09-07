"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Check, ShieldCheck } from "lucide-react";
import type { useBetTransaction } from "@/lib/ui/use-bet-transaction";
import { businessDateLabel, marketDateTime } from "@/lib/ui/market-presentation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { GlassPanel, TicketSection, TicketSurface } from "@/components/ui/surface";
import { usePlayerWallet } from "./player-account";

function methodLabel(method: string, palti: unknown) {
  return `${method === "COPY_PASTE" ? "Copy Paste" : method === "CROSSING" ? "Crossing" : "Jodi"}${palti === true ? " · Palti" : ""}`;
}

export function BetReview({ transaction: tx, marketName, timezone }: { transaction: ReturnType<typeof useBetTransaction>; marketName: string; timezone: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { refresh } = usePlayerWallet();
  useEffect(() => { heading.current?.focus(); }, [tx.receipt]);
  useEffect(() => { if (tx.receipt) void refresh(); }, [tx.receipt, refresh]);
  const busy = tx.phase !== "idle";
  const bet = tx.receipt?.bet;
  const quote = tx.quote;

  if (bet) return <section id="bet-builder" className="bet-confirmation stack" aria-labelledby="ticket-heading">
    <div className="bet-success-heading"><span className="bet-success-icon"><Check aria-hidden="true" /></span><p className="eyebrow">Placement confirmed</p><h2 id="ticket-heading" tabIndex={-1} ref={heading} className="type-section-title">Your bet is placed.</h2><p className="type-body-small text-secondary">Keep your reference for this bet.</p></div>
    <TicketSurface className="bet-receipt" aria-label="Bet receipt">
      <TicketSection><div className="between"><span className="ticket-title">DIAMOND</span><ShieldCheck className="text-accent" aria-hidden="true" /></div><p className="type-caption text-secondary">Public reference</p><p className="bet-reference">{bet.publicRef}</p><h3 className="type-card-title">{bet.market.name}</h3><p className="type-caption text-secondary">{businessDateLabel(bet.businessDate)} · {methodLabel(bet.entryMethod, bet.entryMetadata.palti)}</p></TicketSection>
      <TicketSection><p className="type-label">{bet.totalSelections} selections</p><ul className="bet-receipt-selections" aria-label="Placed selections and stakes">{bet.selections.map(selection => <li key={selection.number}><strong>{selection.number}</strong><Money paise={selection.stakePaise} /></li>)}</ul></TicketSection>
      <TicketSection><dl className="bet-facts"><div><dt>Total stake</dt><dd className="bet-payable"><Money paise={bet.totalStakePaise} /></dd></div><div><dt>Payout rate</dt><dd>{bet.payoutMultiplierSnapshot}×</dd></div><div><dt>Placed · IST</dt><dd><time dateTime={bet.placedAt}>{marketDateTime(bet.placedAt, timezone)}</time></dd></div></dl></TicketSection>
    </TicketSurface>
    <Link className="button button--primary" href={`/my-bets/${encodeURIComponent(bet.publicRef)}`}>View bet & revisions</Link>
    <Link className="button button--secondary" href="/my-bets">My Bets</Link>
    <Link className="button button--secondary" href="/markets">Back to markets</Link>
  </section>;

  return <section id="bet-builder" className="bet-confirmation" aria-labelledby="review-heading">
    <GlassPanel className="bet-review stack" aria-busy={busy}>
      <div><p className="eyebrow">One final check</p><h2 id="review-heading" tabIndex={-1} ref={heading} className="type-section-title">Review your bet</h2><p className="type-body-small text-secondary">{marketName}</p></div>
      {quote && <><dl className="bet-facts"><div><dt>Round</dt><dd>{businessDateLabel(quote.businessDate)}</dd></div><div><dt>Game / input method</dt><dd>{methodLabel(quote.entryMethod, "palti" in quote.entryMetadata && quote.entryMetadata.palti)}</dd></div><div><dt>Selections</dt><dd>{quote.selectionCount}</dd></div></dl>
        <ol className="builder-chips bet-quoted-numbers" aria-label="Quoted selections">{quote.selections.map(selection => <li key={selection.number}>{selection.number}</li>)}</ol>
        <dl className="bet-facts"><div><dt>Stake per selection</dt><dd><Money paise={quote.stakePerSelectionPaise} /></dd></div><div className="bet-total-row"><dt>Total stake</dt><dd className="bet-payable"><Money paise={quote.totalStakePaise} /></dd></div><div><dt>Payout rate</dt><dd>{quote.payoutMultiplier}×</dd></div><div><dt>Credit per winning selection</dt><dd><Money paise={quote.perWinningSelectionCreditPaise} /></dd></div></dl>
        <p className="type-caption text-muted">Winning credit includes the winning selection’s stake. This quote does not reserve funds. Availability, rate and balance are checked again when you place.</p></>}
      {tx.error && <Alert tone="danger" title={tx.uncertain ? "Confirmation pending" : "Bet could not proceed"}>{tx.error}</Alert>}
      {tx.notice && <Alert tone="warning" title="Review updated quote">{tx.notice}</Alert>}
      <p role="status" aria-live="polite" className="type-body-small text-secondary">{tx.phase === "quoting" ? "Checking current amounts and market availability…" : tx.phase === "placing" ? "Placing your bet. Please keep this page open…" : ""}</p>
      <div className="bet-review-actions"><Button variant="secondary" disabled={busy || tx.uncertain} onClick={tx.edit}>Back to builder</Button>{quote ? <Button disabled={busy} loading={busy} onClick={() => void tx.confirm()}>{tx.uncertain ? "Retry same bet" : "Confirm & place bet"}</Button> : <Button disabled={busy} loading={busy} onClick={() => { if (tx.draft) void tx.review(tx.draft); }}>Refresh quote</Button>}</div>
    </GlassPanel>
  </section>;
}
