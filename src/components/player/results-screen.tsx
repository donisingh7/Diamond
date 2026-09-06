"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { MarketDTO } from "@/modules/markets/services/market-dto";
import type { ResultEntry } from "@/modules/markets/services/result.service";
import { usePlayerApi } from "@/lib/ui/use-player-api";
import { businessDateLabel, marketStates, marketTime } from "@/lib/ui/market-presentation";
import { Badge, EmptyState, ErrorState, PageSkeleton } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/surface";

const ranges = [{ value: "today", label: "Today" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }];

export function ResultsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const range = ranges.some(item => item.value === params.get("range")) ? params.get("range")! : "today";
  const market = params.get("market") ?? "";
  const query = new URLSearchParams({ range });
  if (market) query.set("market", market);
  const results = usePlayerApi<{ range: string; results: ResultEntry[]; serverNow: string }>(`/api/results?${query}`);
  const markets = usePlayerApi<{ markets: MarketDTO[]; serverNow: string }>("/api/markets");
  const groups = new Map<string, ResultEntry[]>();
  for (const entry of results.data?.results ?? []) {
    const group = groups.get(entry.businessDate) ?? [];
    group.push(entry);
    groups.set(entry.businessDate, group);
  }

  function filter(nextRange: string, nextMarket: string) {
    const next = new URLSearchParams({ range: nextRange });
    if (nextMarket) next.set("market", nextMarket);
    router.replace(`/results?${next}`, { scroll: false });
  }

  return <div className="player-page"><div className="page-intro"><p className="eyebrow">On the record</p><h1 className="type-display">Results, in focus.</h1><p className="text-secondary">The latest declared numbers and your market history.</p></div><section className="stack" aria-label="Market results"><div className="results-toolbar"><div className="filter-pills" aria-label="Result date range">{ranges.map(item => <button type="button" key={item.value} aria-pressed={range === item.value} onClick={() => filter(item.value, market)}>{item.label}</button>)}</div><div className="market-filter"><label htmlFor="result-market">Market</label><select id="result-market" value={market} onChange={event => filter(range, event.target.value)}><option value="">All markets</option>{market && !markets.data?.markets.some(item => item.slug === market) && <option value={market}>{market}</option>}{markets.data?.markets.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></div></div>{markets.error && <p role="alert" className="type-body-small text-secondary">Market filters couldn’t load. <button className="text-link" type="button" onClick={() => void markets.refresh()}>Retry filters</button></p>}<p className="type-caption text-muted">{range === "today" ? "Current operational rounds. Overnight markets may belong to the previous day." : `Declared results for ${range === "7d" ? "7" : "30"} calendar days, including today.`} All dates and times IST.</p>{results.loading ? <PageSkeleton /> : results.error ? <GlassCard><ErrorState title={results.code === "MARKET_NOT_FOUND" ? "Market not found" : "Results couldn’t load"} description={results.error} action={<Button variant="secondary" onClick={() => results.code === "MARKET_NOT_FOUND" ? filter(range, "") : void results.refresh()}>{results.code === "MARKET_NOT_FOUND" ? "Show all markets" : "Try again"}</Button>} /></GlassCard> : groups.size ? <div className="stack-lg">{Array.from(groups).map(([date, entries]) => <section key={date} className="stack" aria-label={`Results for ${businessDateLabel(date)}`}><div className="result-date"><h2>{businessDateLabel(date)}</h2><span>{entries.length} {entries.length === 1 ? "market" : "markets"}</span></div><div className="result-grid">{entries.map(entry => <GlassCard key={`${entry.slug}-${date}`} className="result-card"><div className="between"><span className="market-code">{entry.code}</span><Badge tone={marketStates[entry.state].tone}>{marketStates[entry.state].label}</Badge></div><div className="result-card-main"><div><h3 className="type-card-title">{entry.name}</h3><p className="type-caption text-muted">{entry.resultDeclaredAt ? `Declared ${marketTime(entry.resultDeclaredAt, "Asia/Kolkata")} IST` : "No declared result"}</p></div><span className={`result-value${entry.result === null ? " result-value--pending" : ""}`} aria-label={entry.result === null ? "No declared result" : `Result ${entry.result}`}>{entry.result ?? "—"}</span></div><Link className="text-link" href={`/markets/${entry.slug}`}>View market <ArrowUpRight aria-hidden="true" /></Link></GlassCard>)}</div></section>)}</div> : <GlassCard><EmptyState title="No declared results in this period" description="Choose another date range or market to explore earlier results." action={market ? <Button variant="secondary" onClick={() => filter(range, "")}>Show all markets</Button> : undefined} /></GlassCard>}<div className="data-note">{results.data && <span>Checked {marketTime(results.data.serverNow, "Asia/Kolkata")} IST · Refreshes every 30 seconds</span>}<Button variant="ghost" size="sm" leadingIcon={<RefreshCw aria-hidden="true" />} onClick={() => void results.refresh()}>Refresh results</Button></div></section></div>;
}
