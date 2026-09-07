"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Clock3, Grid2X2, LockKeyhole, RefreshCw, Wallet } from "lucide-react";
import type { MarketDTO } from "@/modules/markets/services/market-dto";
import type { ResultEntry } from "@/modules/markets/services/result.service";
import { usePlayerApi } from "@/lib/ui/use-player-api";
import { businessDateLabel, countdownTarget, marketDateTime, marketStates, marketTime } from "@/lib/ui/market-presentation";
import { GlassCard, GlassPanel } from "@/components/ui/surface";
import { Alert, Badge, EmptyState, ErrorState, PageSkeleton } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { Countdown } from "@/components/ui/countdown";
import { MarketCard } from "./market-card";
import { BetBuilder } from "./bet-builder";
import { usePlayerWallet } from "./player-account";

type MarketsResponse = { markets: MarketDTO[]; serverNow: string };
type ResultsResponse = { results: ResultEntry[]; range: string; serverNow: string };

function Retry({ refresh }: { refresh: () => Promise<void> }) {
  return <Button variant="secondary" leadingIcon={<RefreshCw aria-hidden="true" />} onClick={() => void refresh()}>Try again</Button>;
}

export function MarketOverview({ home = false }: { home?: boolean }) {
  const markets = usePlayerApi<MarketsResponse>("/api/markets");
  const [filter, setFilter] = useState<"all" | "open">("all");
  const shown = markets.data?.markets.filter(market => filter === "all" || market.round?.canPlaceBet);
  return <section className="stack" aria-labelledby="markets-heading">
    <div className="section-heading"><div><p className="eyebrow">The daily lineup</p><h2 id="markets-heading" className="type-section-title">{home ? "Your markets" : "Choose a market"}</h2></div><div className="filter-pills" aria-label="Market availability"><button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All markets</button><button type="button" aria-pressed={filter === "open"} onClick={() => setFilter("open")}>Open now</button></div></div>
    {markets.loading ? <PageSkeleton /> : markets.error ? <GlassCard><ErrorState title="Markets couldn’t load" description={markets.error} action={<Retry refresh={markets.refresh} />} /></GlassCard> : <>{shown?.length ? <div className="market-grid">{shown.map(market => <MarketCard key={market.slug} market={market} serverNow={markets.data!.serverNow} receivedAt={markets.receivedAt} />)}</div> : <GlassCard><EmptyState icon={<Grid2X2 />} title={filter === "open" ? "No markets open right now" : "No markets available"} description={filter === "open" ? "View all markets to check upcoming opening times." : "Check back here for the next market schedule."} action={filter === "open" ? <Button variant="secondary" onClick={() => setFilter("all")}>View all markets</Button> : <Retry refresh={markets.refresh} />} /></GlassCard>}<div className="data-note"><span>All times IST · Status refreshes every 30 seconds</span>{markets.data && <span>Checked {marketTime(markets.data.serverNow, "Asia/Kolkata")}</span>}</div></>}
  </section>;
}

function WalletSummary() {
  const wallet = usePlayerWallet();
  return <GlassCard className="wallet-summary"><div className="between"><span className="eyebrow">Your wallet</span><Wallet aria-hidden="true" /></div><div><p className="type-caption text-secondary">Available balance</p>{wallet.data ? <Money paise={wallet.data.wallet.availableBalancePaise} size="large" /> : <p className="type-card-title">{wallet.loading ? "Loading balance…" : "Balance unavailable"}</p>}</div>{wallet.error ? <div role="alert"><p className="type-caption text-secondary">{wallet.error}</p><Retry refresh={wallet.refresh} /></div> : <div className="between type-caption text-muted"><span>INR · Indian rupees</span>{wallet.data && wallet.data.wallet.reservedBalancePaise > 0 && <span>Reserved <Money paise={wallet.data.wallet.reservedBalancePaise} /></span>}</div>}</GlassCard>;
}

function TodayResults() {
  const results = usePlayerApi<ResultsResponse>("/api/results?range=today");
  return <section className="stack"><div className="section-heading"><div><p className="eyebrow">On the record</p><h2 className="type-section-title">Today’s results</h2></div><Link className="text-link" href="/results">View results <ArrowUpRight aria-hidden="true" /></Link></div>{results.loading ? <PageSkeleton /> : results.error ? <GlassCard><ErrorState title="Results couldn’t load" description={results.error} action={<Retry refresh={results.refresh} />} /></GlassCard> : results.data?.results.length ? <GlassPanel className="results-strip">{results.data.results.map(result => <Link key={result.slug} href={`/results?market=${result.slug}`} className="result-glance"><span className="type-label">{result.name}</span><span className={`result-value${result.result === null ? " result-value--pending" : ""}`} aria-label={result.result === null ? "No declared result" : `Result ${result.result}`}>{result.result ?? "—"}</span><span className="type-caption text-muted">{result.result === null ? marketStates[result.state].label : businessDateLabel(result.businessDate)}</span></Link>)}</GlassPanel> : <GlassCard><EmptyState title="No results available" description="Declared results will appear here." /></GlassCard>}</section>;
}

export function PlayerHome({ name }: { name: string }) {
  return <div className="player-page"><div className="home-intro"><div className="home-heading"><p className="eyebrow">The day is in play</p><h1>Welcome back,<br /><span>{name}.</span></h1><p className="text-secondary">A clear view of your markets and the day’s results.</p><Link className="button button--primary home-action" href="/markets">Play · Explore markets <ArrowRight aria-hidden="true" /></Link></div><WalletSummary /></div><MarketOverview home /><TodayResults /></div>;
}

export function MarketsScreen() {
  return <div className="player-page"><div className="page-intro"><p className="eyebrow">Play · Market selection</p><h1 className="type-display">Find your market.</h1><p className="text-secondary">Opening times, closing times and the current round. All in view.</p></div><MarketOverview /></div>;
}

export function MarketDetail({ slug }: { slug: string }) {
  const resource = usePlayerApi<{ market: MarketDTO; serverNow: string }>(`/api/markets/${encodeURIComponent(slug)}`);
  if (resource.loading) return <PageSkeleton />;
  if (!resource.data) return <GlassCard><ErrorState title={resource.code === "MARKET_NOT_FOUND" ? "Market not found" : "Market couldn’t load"} description={resource.error} action={resource.code === "MARKET_NOT_FOUND" ? <Link className="text-link" href="/markets">Back to markets <ArrowRight /></Link> : <Retry refresh={resource.refresh} />} /></GlassCard>;
  const { market, serverNow } = resource.data;
  const state = marketStates[market.state];
  const countdown = countdownTarget(market);
  return <div className="player-page"><Link href="/markets" className="text-link"><ArrowLeft aria-hidden="true" />All markets</Link><div className="detail-heading"><div className="page-intro"><p className="eyebrow">{market.code} · Market overview</p><h1 className="type-display">{market.name}</h1><div className="row"><Badge tone={state.tone}>{state.label}</Badge>{market.round && <span className="type-body-small text-secondary">{businessDateLabel(market.round.businessDate)} round</span>}</div></div><span className="detail-monogram" aria-hidden="true">{market.code}</span></div><div className="market-detail-grid"><GlassPanel className="round-panel"><div className="section-heading"><h2 className="type-section-title">Current round</h2><Clock3 className="text-muted" aria-hidden="true" /></div>{market.round ? <><div className="round-countdown"><p className="eyebrow">{countdown?.label ?? "Current result"}</p>{countdown ? <Countdown target={countdown.target} label={countdown.label} serverNow={serverNow} receivedAt={resource.receivedAt} /> : <span className="detail-result">{market.round.result ?? "Awaiting result"}</span>}</div><dl className="round-times">{[{ label: "Opens", instant: market.round.opensAt }, { label: "Editing closes", instant: market.round.editCutoffAt }, { label: "Market closes", instant: market.round.closesAt }].map(item => <div key={item.label}><dt>{item.label}</dt><dd><time dateTime={item.instant}>{marketDateTime(item.instant, market.timezone)}</time><span>IST</span></dd></div>)}</dl><p className="type-caption text-muted">Round date: {businessDateLabel(market.round.businessDate)}. A closing time on the next day belongs to this same round.</p></> : <EmptyState title="Market unavailable" description="There is no active round while this market is disabled." />}</GlassPanel><div className="stack"><GlassCard variant="strong" className="market-availability"><span className="state-icon"><LockKeyhole aria-hidden="true" /></span><p className="eyebrow">Betting availability</p><h2 className="type-section-title">{market.round?.canPlaceBet ? "Market accepting new bets" : "New bets unavailable"}</h2><p className="text-secondary type-body-small">{market.round?.canPlaceBet ? "The market is open. Prepare your selections below; this draft does not place a bet." : market.state === "UPCOMING" ? "This round has not opened yet. Check the opening time for this market." : "You can still view the round schedule and published results."}</p>{market.round?.canPlaceBet && <Alert title={market.round.canEditBet ? "Editing window open" : "Editing is locked"} tone={market.round.canEditBet ? "info" : "warning"}>{market.round.canEditBet ? "Existing bets can be edited until the editing cutoff shown here." : "New bets remain allowed until market close. Existing bets can no longer be edited."}</Alert>}<a href="#bet-builder" className="button button--primary">Build selections <ArrowRight aria-hidden="true" /></a><Link href={`/results?market=${market.slug}`} className="button button--secondary">View market results <ArrowUpRight aria-hidden="true" /></Link></GlassCard><p className="type-caption text-muted">Times shown in IST. Status checked {marketTime(serverNow, market.timezone)} and refreshed every 30 seconds. Countdown is a guide; the server confirms availability.</p></div></div><BetBuilder key={market.slug} /></div>;
}
