import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import type { MarketDTO } from "@/modules/markets/services/market-dto";
import { countdownTarget, marketDateTime, marketStates } from "@/lib/ui/market-presentation";
import { GlassCard } from "@/components/ui/surface";
import { Badge } from "@/components/ui/feedback";
import { Countdown } from "@/components/ui/countdown";

export function MarketCard({ market, serverNow, receivedAt }: { market: MarketDTO; serverNow: string; receivedAt?: number }) {
  const state = marketStates[market.state];
  const countdown = countdownTarget(market);
  return <GlassCard variant="interactive" className="market-card">
    <div className="between"><span className="market-code">{market.code}</span><Badge tone={state.tone}>{state.label}</Badge></div>
    <div className="market-card-heading"><h3>{market.name}</h3><p className="type-caption text-muted">{market.round ? `${market.round.businessDate} round` : "No active round"}</p></div>
    {market.round ? <div className="market-schedule"><div><span>Opens</span><time dateTime={market.round.opensAt}>{marketDateTime(market.round.opensAt, market.timezone)}</time></div><div><span>Closes</span><time dateTime={market.round.closesAt}>{marketDateTime(market.round.closesAt, market.timezone)}</time></div></div> : <p className="type-body-small text-secondary">This market is currently unavailable.</p>}
    <div className="market-card-footer"><div className="market-countdown">{countdown ? <><span className="type-caption text-muted"><Clock3 aria-hidden="true" />{countdown.label}</span><Countdown target={countdown.target} label={countdown.label} compact serverNow={serverNow} receivedAt={receivedAt} /></> : <><span className="type-caption text-muted">Result</span><span className={market.round?.result != null ? "result-inline" : "type-body-small text-secondary"}>{market.round?.result ?? (market.state === "DISABLED" ? "Unavailable" : "Awaiting declaration")}</span></>}</div><Link href={`/markets/${market.slug}`} className="market-enter" aria-label={`View ${market.name}`}><ArrowUpRight aria-hidden="true" /></Link></div>
  </GlassCard>;
}
