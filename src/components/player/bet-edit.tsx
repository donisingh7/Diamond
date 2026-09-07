"use client";

import { useEffect, useRef } from "react";
import type { PlayerBetDetailDTO } from "@/modules/betting/services/bet-read.service";
import type { EntryInput } from "@/modules/betting/validators/bet-input";
import { previewSelections, previewStake } from "@/lib/ui/bet-builder-preview";
import { useBetEdit } from "@/lib/ui/use-bet-edit";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { GlassPanel } from "@/components/ui/surface";
import { Money } from "@/components/ui/money";
import { BetBuilder } from "./bet-builder";
import { BetTime, methodLabel, Selections } from "./bet-presentation";

function initialEntry(bet: PlayerBetDetailDTO): EntryInput {
  if (bet.entryMethod === "CROSSING" && typeof bet.entryMetadata.digits === "string") return { entryMethod: "CROSSING", digits: bet.entryMetadata.digits };
  if (bet.entryMethod === "COPY_PASTE" && typeof bet.entryMetadata.rawInput === "string") return { entryMethod: "COPY_PASTE", rawInput: bet.entryMetadata.rawInput, palti: bet.entryMetadata.palti === true };
  return { entryMethod: "JODI", numbers: bet.selections.map(s => s.number) };
}

export function BetEdit({ bet, eligible, onCancel, onSaved }: { bet: PlayerBetDetailDTO; eligible: boolean; onCancel: () => void; onSaved: (bet: PlayerBetDetailDTO) => void }) {
  const tx = useBetEdit(bet.publicRef);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [tx.pending]);
  const pending = tx.pending;
  const preview = pending ? previewSelections(pending) : undefined;
  const stake = pending ? (pending.stakePaise / 100).toFixed(2) : undefined;
  const total = stake && preview ? previewStake(stake, preview.numbers.length).totalPaise : undefined;
  return <section className="stack" aria-labelledby="edit-bet-heading" aria-busy={tx.busy}>
    <div><p className="eyebrow">{bet.publicRef} · Version {bet.version}</p><h2 ref={heading} tabIndex={-1} id="edit-bet-heading" className="type-section-title">{pending ? "Review changes" : "Edit your bet"}</h2><p className="type-body-small text-secondary">Edits close <BetTime value={bet.editCutoffAt} />. Availability is checked again when you save.</p></div>
    {!eligible && <Alert tone="warning" title="This bet has changed or is no longer editable">Return to the latest bet details. An unconfirmed edit can still be retried to recover its result.</Alert>}
    <div hidden={!!pending || !eligible}><BetBuilder marketSlug={bet.market.slug} marketName={bet.market.name} timezone="Asia/Kolkata" initialEntry={initialEntry(bet)} initialStake={bet.selections[0] ? (bet.selections[0].stakePaise / 100).toFixed(2) : ""} onReview={request => {
      const entry: EntryInput = request.entryMethod === "JODI" ? { entryMethod: "JODI", numbers: request.numbers } : request.entryMethod === "CROSSING" ? { entryMethod: "CROSSING", digits: request.digits } : { entryMethod: "COPY_PASTE", rawInput: request.rawInput, palti: request.palti };
      tx.review({ ...entry, stakePaise: request.stakePaise, expectedVersion: bet.version });
    }} /></div>
    {pending && <GlassPanel className="bet-review stack">
      <p className="type-label">{methodLabel({ entryMethod: pending.entryMethod, entryMetadata: pending.entryMethod === "COPY_PASTE" ? { palti: pending.palti } : {} })} · {preview?.numbers.length} selections</p>
      <Selections selections={(preview?.numbers ?? []).map(number => ({ number, stakePaise: pending.stakePaise }))} />
      <dl className="bet-facts"><div><dt>Current total</dt><dd><Money paise={bet.totalStakePaise} /></dd></div><div><dt>New estimated total</dt><dd>{total !== undefined && <Money paise={total} />}</dd></div><div><dt>Multiplier snapshot</dt><dd>{bet.payoutMultiplierSnapshot}×</dd></div></dl>
      <Alert title="Wallet adjustment on save">Saving replaces the whole bet. The server checks your balance and calculates any additional debit or refund. The confirmed amount appears with your saved revision.</Alert>
      {tx.error && <Alert tone="danger" title={tx.uncertain ? "Confirmation pending" : "Changes were not saved"}>{tx.error}</Alert>}
      <div className="bet-review-actions"><Button variant="secondary" disabled={tx.busy || tx.uncertain} onClick={tx.back}>Back to changes</Button><Button disabled={tx.busy || tx.rejected || (!eligible && !tx.uncertain)} loading={tx.busy} onClick={async () => { const updated = await tx.confirm(); if (updated) onSaved(updated); }}>{tx.uncertain ? "Retry same edit" : "Confirm & save changes"}</Button></div>
    </GlassPanel>}
    <Button variant="secondary" disabled={tx.busy || tx.uncertain} onClick={onCancel}>Return to bet details</Button>
  </section>;
}
