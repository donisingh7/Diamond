"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { AdminMarketDTO } from "@/modules/admin/services/admin-market.service";
import type { DeclaredResult, ResultDeclarationPreview } from "@/modules/admin/services/admin-result.service";
import type { AdminRoundSettlement } from "@/modules/admin/services/admin-settlement.service";
import { prepareResultSchema, declareResultSchema, settleRoundSchema, updateMarketScheduleSchema } from "@/modules/admin/validators/admin-ops-input";
import { adminRequest, useAdminApi, useAdminMutation } from "@/lib/ui/use-admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Alert } from "@/components/ui/feedback";
import { GlassCard, GlassPanel } from "@/components/ui/surface";
import { BetTime } from "@/components/player/bet-presentation";
import { AdminConfirm, FormAction, Intro, ReadState, Select, Status, formText } from "./admin-ui";

type MarketsResponse = { markets: AdminMarketDTO[]; serverNow: string };
function RoundFacts({ market }: { market: AdminMarketDTO }) {
  const round = market.currentRound;
  return round ? <dl className="bet-facts"><div><dt>Round</dt><dd>{round.businessDate}</dd></div><div><dt>Opens</dt><dd><BetTime value={round.opensAt} /></dd></div><div><dt>Edit cutoff</dt><dd><BetTime value={round.editCutoffAt} /></dd></div><div><dt>Closes</dt><dd><BetTime value={round.closesAt} /></dd></div><div><dt>Declared result</dt><dd>{round.result ?? "Pending"}</dd></div><div><dt>Settlement</dt><dd><Status value={round.settlementStatus} /></dd></div>{round.resultDeclaredAt && <div><dt>Declared at</dt><dd><BetTime value={round.resultDeclaredAt} /></dd></div>}</dl> : <p className="type-body-small text-secondary">No current round returned by the server.</p>;
}
export function AdminMarkets() {
  const api = useAdminApi<MarketsResponse>("/api/admin/markets");
  const tx = useAdminMutation<{ market: AdminMarketDTO }>();
  return <div className="stack-lg admin-operations"><Intro title="Markets" description="Server-reported states, current round timings and future schedules." />{tx.result && <Alert tone="success" title="Market updated">{tx.result.market.name}</Alert>}<ReadState api={api} empty={!api.data?.markets.length}><ul className="admin-records">{api.data?.markets.map(market => <li key={market.id}><GlassPanel className="stack"><div className="between"><h2 className="type-section-title">{market.name}</h2><Status value={market.state} /></div><p className="type-caption text-secondary">{market.code} · {market.slug} · {market.enabled ? "Enabled" : "Disabled"}</p><RoundFacts market={market} />
      <div className="wallet-actions"><Button variant="secondary" disabled={!!tx.job} onClick={() => tx.prepare({ url: `/api/admin/markets/${market.id}/status`, body: { enabled: !market.enabled }, title: market.enabled ? "Disable market" : "Enable market", description: `${market.name}\n${market.enabled ? "New bets will be blocked immediately by the server. Historical rounds remain unchanged." : "The server’s schedule and availability checks will apply."}` })}>{market.enabled ? "Disable market" : "Enable market"}</Button><Link className="button button--secondary" href={`/admin/results/${market.id}`}>Results</Link></div>
      <details className="admin-disclosure"><summary>Future schedule · {market.schedule.openTime}–{market.schedule.closeTime}{market.schedule.closeDayOffset ? " (+1 day)" : ""}</summary><p className="type-caption text-secondary">{market.timezone}. Changes apply only to newly-created rounds; existing round times remain unchanged.</p><FormAction key={`${market.schedule.openTime}-${market.schedule.closeTime}-${market.schedule.closeDayOffset}-${market.schedule.editLockMinutesBeforeClose}`} disabled={!!tx.job} prepare={tx.prepare} build={data => { const body = updateMarketScheduleSchema.parse({ openTime: formText(data, "openTime"), closeTime: formText(data, "closeTime"), closeDayOffset: Number(formText(data, "closeDayOffset")), editLockMinutesBeforeClose: Number(formText(data, "editLockMinutesBeforeClose")) }); return { url: `/api/admin/markets/${market.id}/schedule`, body, title: "Update future market schedule", description: `${market.name} · ${market.timezone}\n${body.openTime}–${body.closeTime} · close day offset ${body.closeDayOffset}\nEdit lock: ${body.editLockMinutesBeforeClose} minutes before close.\nExisting persisted round times will not change.` }; }}><div className="admin-form-grid"><Input name="openTime" label="Open time" type="time" required defaultValue={market.schedule.openTime} /><Input name="closeTime" label="Close time" type="time" required defaultValue={market.schedule.closeTime} /><Select name="closeDayOffset" label="Close day" defaultValue={market.schedule.closeDayOffset}><option value="0">Same day</option><option value="1">Next day</option></Select><Input name="editLockMinutesBeforeClose" label="Edit lock (minutes before close)" type="number" min={0} max={1440} step={1} required defaultValue={market.schedule.editLockMinutesBeforeClose} /></div></FormAction></details>
    </GlassPanel></li>)}</ul></ReadState><AdminConfirm tx={tx} onSuccess={() => void api.refresh()} /></div>;
}

export function AdminResults({ initialMarket }: { initialMarket?: string }) {
  const api = useAdminApi<MarketsResponse>("/api/admin/markets");
  const [marketId, setMarketId] = useState(initialMarket ?? "");
  const market = marketId ? api.data?.markets.find(item => item.id === marketId) : api.data?.markets[0];
  return <div className="stack-lg admin-operations"><Intro title="Results" description="Prepare and confirm a result after the round closes. Declaration does not settle bets." /><ReadState api={api} empty={!api.data?.markets.length}>{!market && api.data && <Alert tone="danger" title="Market unavailable">The selected market was not returned. Open this screen from Markets to choose an available market.</Alert>}{market && <><Select label="Market" value={market.id} onChange={event => setMarketId(event.target.value)}>{api.data?.markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><ResultDeclaration key={market.id} market={market} refresh={api.refresh} /></>}</ReadState></div>;
}

function ResultDeclaration({ market, refresh }: { market: AdminMarketDTO; refresh: () => Promise<void> }) {
  const [preview, setPreview] = useState<ResultDeclarationPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const tx = useAdminMutation<{ result: DeclaredResult }>();
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    const data = new FormData(event.currentTarget);
    inFlight.current = true; setBusy(true); setError(undefined);
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const body = prepareResultSchema.parse({ marketId: market.id, businessDate: formText(data, "businessDate"), result: formText(data, "result") });
      const response = await adminRequest<{ preview: ResultDeclarationPreview }>("/api/admin/results/prepare", "POST", JSON.stringify(body), controller.signal);
      setPreview(response.preview);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not prepare result. Try again."); }
    finally { clearTimeout(timeout); inFlight.current = false; setBusy(false); }
  }
  const declared = tx.result?.result;
  return <div className="stack"><GlassPanel className="stack"><div className="between"><h2 className="type-section-title">{market.name}</h2><Status value={market.state} /></div><RoundFacts market={market} /></GlassPanel>
    {declared ? <Alert tone="success" title={declared.idempotentReplay ? "Existing declaration recovered" : "Result declared"}>{declared.market.name} · {declared.businessDate} · Result {declared.result}. Settlement has not been performed by this action.<p><Link className="text-link" href={`/admin/settlement/${market.id}/${declared.businessDate}`}>Continue to settlement →</Link></p></Alert> : <GlassPanel className="stack">
      {!preview ? <form className="stack" onSubmit={event => void prepare(event)}><h2 className="type-card-title">Prepare result declaration</h2><p className="type-caption text-secondary">Choose the exact business date. The server rejects declarations before close or changes to an existing result.</p><Input label="Business date" name="businessDate" type="date" defaultValue={market.currentRound?.businessDate ?? market.currentBusinessDate} required disabled={busy} /><Input label="Result (00–99)" name="result" inputMode="numeric" pattern="[0-9]{2}" minLength={2} maxLength={2} placeholder="e.g. 07" required disabled={busy} />{error && <Alert tone="danger" title="Result not prepared">{error}</Alert>}<Button type="submit" loading={busy}>Prepare result</Button></form> : <><h2 className="type-section-title">Server preview</h2><p>{preview.market.name} · {preview.businessDate}</p><p>Round closed <BetTime value={preview.closesAt} /></p>{preview.alreadyDeclared ? <Alert title="Result already declared">Recorded result: {preview.currentResult}. It cannot be modified here.</Alert> : <><p className="admin-result-number">{preview.proposedResult}</p><Alert tone="warning" title="Confirm the exact result">Declaring a result is irreversible here. Settlement is a separate step.</Alert><Button disabled={!!tx.job} onClick={() => tx.prepare({ url: "/api/admin/results/declare", body: declareResultSchema.parse({ marketId: preview.market.id, businessDate: preview.businessDate, result: preview.proposedResult, confirm: true, clientRequestId: crypto.randomUUID() }), replaySafe: true, title: "Declare round result", description: `${preview.market.name} · ${preview.businessDate}\nFinal result: ${preview.proposedResult}\nConfirm this exact round and number. The result cannot be changed here. This does not settle bets.`, confirmationText: preview.proposedResult, confirmLabel: "Declare result" })}>Confirm result declaration</Button></>}{preview.alreadyDeclared && <Link className="text-link" href={`/admin/settlement/${market.id}/${preview.businessDate}`}>Open settlement →</Link>}<Button variant="secondary" disabled={!!tx.job} onClick={() => setPreview(undefined)}>Back to result input</Button></>}
    </GlassPanel>}<AdminConfirm tx={tx} onSuccess={() => void refresh()} />
  </div>;
}

export function AdminSettlement({ initialMarket, initialDate }: { initialMarket?: string; initialDate?: string }) {
  const api = useAdminApi<MarketsResponse>("/api/admin/markets");
  const tx = useAdminMutation<{ settlement: AdminRoundSettlement }>();
  const [marketId, setMarketId] = useState(initialMarket ?? "");
  const market = marketId ? api.data?.markets.find(item => item.id === marketId) : api.data?.markets[0];
  const result = tx.result?.settlement;
  return <div className="stack-lg admin-operations"><Intro title="Settlement" description="Settle one declared round. Results cannot be entered or modified on this screen." />
    {result && <GlassPanel className="stack"><Alert tone="success" title={result.alreadySettled ? "Round already settled · stored summary" : "Settlement complete"}>{result.market.name} · {result.businessDate} · Result {result.result}{result.alreadySettled && <p>No additional funds were credited by this replay.</p>}</Alert><div className="admin-metrics"><GlassCard><p>Processed this run</p><strong className="type-section-title">{result.processedBets}</strong></GlassCard><GlassCard><p>Won / lost</p><strong className="type-section-title">{result.wonCount} / {result.lostCount}</strong></GlassCard><GlassCard><p>Total bets</p><strong className="type-section-title">{result.totalBets}</strong></GlassCard><GlassCard><p>Total credited</p><Money paise={result.totalCreditedPaise} /></GlassCard></div><p>Credited this run: <Money paise={result.creditedThisRunPaise} /></p><p className="type-caption">Settled <BetTime value={result.settledAt} /></p></GlassPanel>}
    <ReadState api={api} empty={!api.data?.markets.length}>{!market && api.data && <Alert tone="danger" title="Market unavailable">The selected market was not returned. Open this screen from Markets to choose an available market.</Alert>}{market && <GlassPanel className="stack admin-narrow"><Select label="Market" value={market.id} disabled={!!tx.job} onChange={event => setMarketId(event.target.value)}>{api.data?.markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><RoundFacts market={market} /><FormAction key={market.id} disabled={!!tx.job} label="Review settlement" prepare={tx.prepare} build={data => {
      const body = settleRoundSchema.parse({ marketId: market.id, businessDate: formText(data, "businessDate"), confirm: true, clientRequestId: crypto.randomUUID() });
      return { url: "/api/admin/results/settle", body, replaySafe: true, title: "Settle declared round", description: `${market.name} · ${body.businessDate}\nThis processes bets and credits winners using the result already recorded on the server and each bet’s multiplier snapshot. No result is changed. An already-settled round returns its stored summary without another credit.`, confirmationText: body.businessDate, confirmLabel: "Settle round" };
    }}><Input label="Business date to settle" name="businessDate" type="date" required defaultValue={initialDate ?? market.currentRound?.businessDate ?? market.currentBusinessDate} /><p className="type-body-small text-secondary">For a historical round, enter its exact business date. The server requires an existing declared result before processing.</p></FormAction></GlassPanel>}</ReadState><AdminConfirm tx={tx} onSuccess={() => void api.refresh()} />
  </div>;
}
