"use client";

import * as Dialog from "@radix-ui/react-alert-dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, Badge, CardSkeleton, EmptyState, ErrorState } from "@/components/ui/feedback";
import type { AdminJob, useAdminMutation } from "@/lib/ui/use-admin-api";

export function label(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, character => character.toUpperCase()); }
export function Status({ value }: { value: string }) { return <Badge tone={["ACTIVE", "OPEN", "WON", "APPROVED", "SETTLED", "RESULT_DECLARED"].includes(value) ? "success" : ["PENDING", "CLOSING_SOON", "PROCESSING", "RESULT_PENDING"].includes(value) ? "warning" : ["DISABLED", "REJECTED"].includes(value) ? "danger" : "neutral"}>{label(value)}</Badge>; }
export function Intro({ title, description, children }: { title: string; description: string; children?: ReactNode }) { return <div className="section-heading"><div><p className="eyebrow">Diamond operations</p><h1 className="type-page-title">{title}</h1><p className="type-body-small text-secondary">{description}</p></div>{children}</div>; }
export function ReadState({ api, empty = false, children }: { api: { data?: unknown; loading: boolean; error?: string; refresh: () => Promise<void> }; empty?: boolean; children: ReactNode }) {
  // Keep loaded children mounted during a failed background refresh, including pending confirmations.
  return <>{api.loading && <CardSkeleton />}{api.error && <ErrorState title="Could not refresh records" description={`${api.error}${api.data ? " Previously loaded records remain below." : ""}`} action={<Button onClick={() => void api.refresh()}>Try again</Button>} />}{!api.loading && !api.error && empty && <EmptyState title="No matching records" description="Try a different filter or refresh when new activity is available." />}{api.data !== undefined && !empty && children}</>;
}
export function Pages({ api, next }: { api: { page: number; loading: boolean; newer: () => void; older: (cursor: string) => void }; next?: string | null }) {
  if (api.page === 1 && !next) return null;
  return <nav className="wallet-pagination" aria-label="Record pages"><Button variant="secondary" disabled={api.loading || api.page === 1} onClick={api.newer}>Newer</Button><span className="type-caption" role="status">Page {api.page}</span><Button variant="secondary" disabled={api.loading || !next} onClick={() => { if (next) api.older(next); }}>Older</Button></nav>;
}
export type FilterField = { name: string; label: string; type?: string; options?: string[]; placeholder?: string };
export function Filters({ fields, initial = "", onApply }: { fields: FilterField[]; initial?: string; onApply: (query: string) => void }) {
  const defaults = new URLSearchParams(initial);
  return <form className="admin-filters" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const query = new URLSearchParams(); for (const field of fields) { const value = String(data.get(field.name) ?? "").trim(); if (value) query.set(field.name, value); } onApply(query.toString()); }}>
    {fields.map(field => field.options ? <Select key={field.name} name={field.name} label={field.label} defaultValue={defaults.get(field.name) ?? ""}><option value="">All</option>{field.options.map(value => <option key={value} value={value}>{label(value)}</option>)}</Select> : <Input key={field.name} name={field.name} label={field.label} type={field.type ?? "text"} placeholder={field.placeholder} defaultValue={defaults.get(field.name) ?? ""} />)}
    <Button type="submit" variant="secondary">Apply filters</Button><Button type="reset" variant="ghost" onClick={event => { event.currentTarget.form?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach(input => { input.value = ""; }); onApply(""); event.preventDefault(); }}>Clear</Button>
  </form>;
}
export function Select({ label: title, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) { return <label className="field admin-select"><span className="type-label">{title}</span><select {...props}>{children}</select></label>; }
export function formText(data: FormData, name: string) { return String(data.get(name) ?? "").trim(); }
export function optionalText(data: FormData, name: string) { const value = formText(data, name); return value ? { [name]: value } : {}; }
export function FormAction({ children, build, prepare, label: buttonLabel = "Review changes", disabled = false }: { children: ReactNode; build: (data: FormData) => AdminJob; prepare: (job: AdminJob) => void; label?: string; disabled?: boolean }) {
  const [error, setError] = useState<string>();
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  return <form className="stack" onSubmit={event => { event.preventDefault(); try { const job = build(new FormData(event.currentTarget)); setError(undefined); prepare(job); } catch (failure) { const issues = failure && typeof failure === "object" && "issues" in failure && Array.isArray(failure.issues) ? failure.issues as { message: string; path: PropertyKey[] }[] : undefined; setError(issues ? issues.map(issue => { const field = issue.path.map(String).join(" ").replace(/Paise\b/g, "").replace(/([a-z])([A-Z])/g, "$1 $2"); return `${label(field)}: ${issue.message}`; }).join(" ") : failure instanceof Error ? failure.message : "Check your input."); } }}><fieldset className="admin-form-fields stack" disabled={disabled}>{children}<Button type="submit">{buttonLabel}</Button></fieldset>{error && <div ref={errorSummary} tabIndex={-1}><Alert tone="danger" title="Check the form">{error}</Alert></div>}</form>;
}
export function AdminConfirm<T>({ tx, onSuccess }: { tx: ReturnType<typeof useAdminMutation<T>>; onSuccess?: (result: T) => void }) {
  const [typed, setTyped] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const job = tx.job;
  return <Dialog.Root open={!!job} onOpenChange={open => { if (!open) tx.close(); setTyped(""); }}><Dialog.Portal><Dialog.Overlay className="overlay-backdrop" /><Dialog.Content className="overlay-surface overlay-surface--modal admin-confirm" onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => { const target = returnFocus.current; if (target?.isConnected && target !== document.body && !target.matches(":disabled")) target.focus(); else document.getElementById("admin-content")?.focus(); }); }} onEscapeKeyDown={event => { if (tx.busy || (tx.uncertain && job?.replaySafe)) event.preventDefault(); }}><div className="stack"><Dialog.Title className="type-section-title">{job?.title}</Dialog.Title><Dialog.Description className="text-secondary admin-preserve-lines">{job?.description}</Dialog.Description>
    {job?.confirmationText && <Input label={`Type ${job.confirmationText} to confirm`} autoComplete="off" value={typed} onChange={event => setTyped(event.target.value)} disabled={tx.busy || tx.uncertain} />}
    {tx.error && <Alert tone="danger" title={tx.uncertain ? "Confirmation pending" : "Action not completed"}>{tx.error}</Alert>}
    <div className="wallet-actions"><Dialog.Cancel asChild><Button variant="secondary" disabled={tx.busy || (tx.uncertain && job?.replaySafe)}>{tx.uncertain ? "Close & verify records" : "Cancel"}</Button></Dialog.Cancel><Button variant={job?.destructive ? "danger" : "primary"} loading={tx.busy} disabled={(tx.uncertain && !job?.replaySafe) || (!tx.uncertain && !!job?.confirmationText && typed !== job.confirmationText)} onClick={async () => { const result = await tx.confirm(); if (result !== undefined) { setTyped(""); onSuccess?.(result); } }}>{tx.uncertain ? "Retry same action" : job?.confirmLabel ?? "Confirm"}</Button></div>
  </div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function Snapshot({ value }: { value: Record<string, unknown> | null }) { return value ? <dl className="admin-snapshot">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{label(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</dt><dd>{item !== null && typeof item === "object" ? <pre>{JSON.stringify(item, null, 2)}</pre> : String(item ?? "—")}</dd></div>)}</dl> : <p className="text-muted type-caption">No snapshot</p>; }
