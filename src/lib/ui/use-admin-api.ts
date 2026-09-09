"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class AdminRequestError extends Error {
  constructor(message: string, readonly uncertain: boolean, readonly code?: string) { super(message); }
}
export async function adminRequest<T>(url: string, method = "GET", body?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", credentials: "same-origin", signal, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body }) });
  const payload: { data?: T; error?: { code?: string; message?: string } } = await response.json();
  if (!response.ok || payload.data === undefined) throw new AdminRequestError(payload.error?.message ?? "The server could not confirm this request.", response.status >= 500 || response.ok, payload.error?.code);
  return payload.data;
}

export function useAdminApi<T>(url: string) {
  const [state, setState] = useState<{ url: string; data?: T; error?: string; loading: boolean }>({ url, loading: true });
  const current = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController(); current.current = controller;
    setState(previous => previous.url === url && previous.data ? previous : { url, loading: true });
    const timeout = setTimeout(() => controller.abort("timeout"), 15000);
    try {
      const data = await adminRequest<T>(url, "GET", undefined, controller.signal);
      if (!controller.signal.aborted) setState({ url, data, loading: false });
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason !== "timeout") return;
      if (error instanceof AdminRequestError && error.code === "UNAUTHENTICATED") { window.location.replace("/admin/login"); return; }
      setState(previous => ({ url, data: previous.url === url ? previous.data : undefined, loading: false, error: error instanceof AdminRequestError ? error.message : "Connection interrupted. Try again." }));
    } finally { clearTimeout(timeout); }
  }, [url]);
  useEffect(() => {
    const start = setTimeout(() => void refresh(), 0);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = setInterval(visible, 30000);
    window.addEventListener("focus", visible);
    return () => { clearTimeout(start); clearInterval(interval); current.current?.abort(); window.removeEventListener("focus", visible); };
  }, [refresh]);
  return { ...(state.url === url ? state : { url, loading: true }), refresh };
}

export function useAdminPage<T>(path: string, initialFilters = "") {
  const [filters, setFilters] = useState(initialFilters);
  const [cursors, setCursors] = useState<string[]>([]);
  const query = new URLSearchParams(filters);
  const cursor = cursors.at(-1); if (cursor) query.set("cursor", cursor);
  const api = useAdminApi<T>(`${path}?${query}`);
  return { ...api, filters, page: cursors.length + 1,
    filter: (value: string) => { setFilters(value); setCursors([]); },
    newer: () => setCursors(list => list.slice(0, -1)), older: (value: string) => setCursors(list => [...list, value]),
  };
}

export type AdminJob = { url: string; method?: "POST" | "PATCH" | "DELETE"; body?: object; title: string; description: string; confirmLabel?: string; destructive?: boolean; confirmationText?: string; replaySafe?: boolean };
export function useAdminMutation<T>() {
  const [job, setJob] = useState<(Omit<AdminJob, "body"> & { body?: string })>();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<T>();
  const inFlight = useRef(false);
  const done = useRef(false);
  function prepare(next: AdminJob) {
    if (inFlight.current || job) return;
    done.current = false; setResult(undefined); setError(undefined); setUncertain(false);
    setJob({ ...next, body: next.body === undefined ? undefined : JSON.stringify(next.body) });
  }
  function close() {
    if (inFlight.current || (uncertain && job?.replaySafe)) return;
    setJob(undefined); setError(undefined); setUncertain(false);
  }
  async function confirm() {
    if (!job || inFlight.current || done.current || (uncertain && !job.replaySafe)) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const data = await adminRequest<T>(job.url, job.method ?? "POST", job.body, controller.signal);
      done.current = true; setResult(data); setJob(undefined); setUncertain(false); return data;
    } catch (failure) {
      const unknown = uncertain || !(failure instanceof AdminRequestError) || failure.uncertain;
      setUncertain(unknown);
      setError(unknown ? job.replaySafe ? "Confirmation was interrupted. Keep this dialog open and retry the exact same action to recover its result safely." : "Confirmation was interrupted. Close this dialog and refresh the server records to verify the outcome before starting another action." : failure instanceof Error ? failure.message : "Action failed.");
    } finally { clearTimeout(timeout); inFlight.current = false; setBusy(false); }
  }
  return { job, busy, uncertain, error, result, prepare, close, confirm };
}
