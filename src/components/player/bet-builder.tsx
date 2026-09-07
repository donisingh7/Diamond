"use client";

import { useId, useState } from "react";
import { Check, Layers3 } from "lucide-react";
import type { EntryInput } from "@/modules/betting/validators/bet-input";
import { previewSelections, previewStake } from "@/lib/ui/bet-builder-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { NumberTile } from "@/components/ui/number-tile";
import { GlassCard, GlassPanel } from "@/components/ui/surface";
import { Tabs } from "@/components/ui/tabs";
import { rupeesToPaise } from "@/lib/money";
import { useBetTransaction } from "@/lib/ui/use-bet-transaction";
import { BetReview } from "./bet-review";

const jodiNumbers = Array.from({ length: 100 }, (_, index) => String(index).padStart(2, "0"));

function NumberPreview({ numbers, label }: { numbers: string[]; label: string }) {
  if (!numbers.length) return null;
  const shown = numbers.slice(0, 12);
  return <div className="builder-number-preview">
    <p className="type-caption text-secondary">{label} · {numbers.length}</p>
    <ol className="builder-chips" aria-label={label}>{shown.map((number, index) => <li key={`${index}-${number}`}>{number}</li>)}</ol>
    {numbers.length > shown.length && <details className="builder-disclosure"><summary>Show all {numbers.length} numbers</summary><ol className="builder-chips builder-chips--expanded" aria-label={`All ${label.toLowerCase()}`}>{numbers.map((number, index) => <li key={`${index}-${number}`}>{number}</li>)}</ol></details>}
  </div>;
}

export function BetBuilder({ marketSlug, marketName, timezone }: { marketSlug: string; marketName: string; timezone: string }) {
  const id = useId();
  const transaction = useBetTransaction();
  const [method, setMethod] = useState<EntryInput["entryMethod"]>("JODI");
  const [numbers, setNumbers] = useState<string[]>([]);
  const [digits, setDigits] = useState("");
  const [rawInput, setRawInput] = useState("");
  const [palti, setPalti] = useState(false);
  const [stake, setStake] = useState("");
  const entry: EntryInput = method === "JODI" ? { entryMethod: method, numbers } : method === "CROSSING" ? { entryMethod: method, digits } : { entryMethod: method, rawInput, palti };
  const preview = previewSelections(entry);
  const amount = previewStake(stake, preview.numbers.length);
  function clearSelections() {
    if (method === "JODI") setNumbers([]);
    else if (method === "CROSSING") setDigits("");
    else setRawInput("");
  }
  const hasInput = method === "JODI" ? numbers.length > 0 : method === "CROSSING" ? !!digits : !!rawInput;

  if (transaction.draft) return <BetReview transaction={{ ...transaction, edit: () => { transaction.edit(); requestAnimationFrame(() => document.getElementById(`${id}-heading`)?.focus()); } }} marketName={marketName} timezone={timezone} />;

  return <section id="bet-builder" className="stack bet-builder" aria-labelledby={`${id}-heading`}>
    <div className="section-heading"><div><p className="eyebrow">Your numbers. Your combination.</p><h2 id={`${id}-heading`} tabIndex={-1} className="type-section-title">Build your selections</h2></div><span className="builder-draft-label"><Layers3 size={16} aria-hidden="true" />Draft only</span></div>
    <div className="builder-layout">
      <GlassPanel className="builder-input-panel">
        <Tabs label="Bet entry method" value={method} onValueChange={value => { if (value === "JODI" || value === "CROSSING" || value === "COPY_PASTE") setMethod(value); }} items={[
          { value: "JODI", label: "Jodi", content: <div className="stack"><p className="type-body-small text-secondary">Choose any numbers from 00–99. Tap a selected number again to remove it.</p><div className="jodi-grid" role="group" aria-label="Jodi numbers">{jodiNumbers.map(number => <NumberTile key={number} value={number} selected={numbers.includes(number)} aria-label={`Jodi ${number}`} onClick={() => setNumbers(current => current.includes(number) ? current.filter(value => value !== number) : [...current, number])} />)}</div></div> },
          { value: "CROSSING", label: "Crossing", content: <div className="stack">
            <Input label="Digits to cross" value={digits} onChange={event => setDigits(event.target.value)} inputMode="numeric" maxLength={100} autoComplete="off" placeholder="e.g. 428935" helperText="Use digits only, without spaces. Each unique digit pairs with every digit, including itself." error={method === "CROSSING" ? preview.error : undefined} />
            <div className="builder-examples"><p className="type-caption text-muted">Try an example</p><Button variant="secondary" size="sm" onClick={() => setDigits("428935")}>428935 → 36 selections</Button><Button variant="secondary" size="sm" onClick={() => setDigits("4428")}>4428 → 9 selections</Button></div>
            <div className="builder-unique"><p className="type-label">Unique digits being used</p>{preview.uniqueDigits?.length ? <div className="builder-chips" aria-label="Unique digits">{preview.uniqueDigits.map(digit => <span key={digit}>{digit}</span>)}</div> : <p className="type-caption text-secondary">{preview.error ? "Correct the input to see your digits." : "Enter digits to see your combinations."}</p>}</div>
          </div> },
          { value: "COPY_PASTE", label: "Copy Paste", content: <div className="stack">
            <div className="field"><label htmlFor={`${id}-paste`} className="type-label">Paste your numbers</label><textarea id={`${id}-paste`} className="builder-textarea" value={rawInput} onChange={event => setRawInput(event.target.value)} maxLength={2000} rows={4} spellCheck={false} autoComplete="off" placeholder={"00 07 10\n22,15,48"} aria-invalid={!!preview.error} aria-describedby={`${id}-paste-help${preview.error ? ` ${id}-paste-error` : ""}`} /><p id={`${id}-paste-help`} className="type-caption text-secondary">Use two-digit numbers separated by spaces, newlines, commas or dots. A continuous string like 2215489635 also works. Keep leading zeros.</p>{preview.error && <p id={`${id}-paste-error`} className="type-caption text-danger">{preview.error}</p>}</div>
            <label className="builder-palti"><span><span className="type-label">Palti</span><span className="type-caption text-secondary">Also include the reverse: 07 → 70. Doubles count once.</span></span><input type="checkbox" checked={palti} onChange={event => setPalti(event.target.checked)} /></label>
            {preview.parsedNumbers && <NumberPreview numbers={preview.parsedNumbers} label="Parsed numbers" />}
          </div> },
        ]} />
      </GlassPanel>
      <GlassCard className="builder-summary" variant="strong">
        <div className="between"><p className="eyebrow">Selection preview</p><Button size="sm" variant="ghost" disabled={!hasInput} onClick={clearSelections}>Clear selections</Button></div>
        <div className="builder-count" role="status" aria-live="polite" aria-atomic="true"><strong>{preview.error ? "—" : preview.numbers.length}</strong><span>{preview.error ? "Check your input" : "unique selections"}</span></div>
        {preview.numbers.length > 0 ? <><p className="type-caption text-secondary"><Check size={14} aria-hidden="true" /> Each number counts once{method === "COPY_PASTE" && palti ? ", including Palti" : ""}.</p><NumberPreview numbers={preview.numbers} label="Resulting selections" /></> : <p className="type-body-small text-secondary">{preview.error ? "Correct the highlighted input to rebuild your preview. No partial selections are used." : "Your selected numbers will appear here. Choose a method to get started."}</p>}
        <div className="builder-stake"><Input label="Stake per selection (₹)" inputMode="decimal" autoComplete="off" placeholder="e.g. 10" value={stake} onChange={event => setStake(event.target.value)} maxLength={32} helperText="The same stake applies to every resulting selection." error={amount.error} />
          <div className="builder-total" role="status" aria-live="polite" aria-atomic="true"><span>Estimated total</span><strong>{amount.totalPaise === undefined ? "—" : <Money paise={amount.totalPaise} />}</strong></div>
        </div>
        <p className="type-caption text-muted">Local draft only. Nothing is placed or saved. Final amounts and availability require server confirmation.</p>
        <Button disabled={!!preview.error || !!amount.error || !amount.totalPaise} onClick={() => void transaction.review({ ...entry, marketSlug, stakePaise: rupeesToPaise(stake) })}>Review bet</Button>
      </GlassCard>
    </div>
  </section>;
}
