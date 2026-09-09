"use client";

import { useRef, useState } from "react";
import type { Deposit, DepositSubmission } from "./deposit-contract";

export class DepositRequestError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}
export async function depositRequest<T>(url: string, body: string | FormData): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}), body });
    const payload: { data?: T; error?: { message?: string } } = await response.json();
    if (!response.ok || payload.data === undefined) throw new DepositRequestError(payload.error?.message ?? "The server could not confirm this request.", response.status >= 500 || response.ok);
    return payload.data;
  } finally { clearTimeout(timeout); }
}
export function useDepositAction() {
  const [pending, setPending] = useState<DepositSubmission>();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const done = useRef(false);
  function prepare(value: DepositSubmission) {
    if (inFlight.current || pending) return;
    done.current = false; setPending({ ...value }); setError(undefined); setUncertain(false);
  }
  function reset() {
    if (inFlight.current || uncertain) return;
    setPending(undefined); setError(undefined);
  }
  async function confirm() {
    if (!pending || inFlight.current || done.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await depositRequest<{ deposit: Deposit }>("/api/deposits", JSON.stringify(pending));
      if (!result.deposit?.id) throw new DepositRequestError("The response did not confirm a deposit.", true);
      done.current = true; setPending(undefined); setUncertain(false); return result.deposit;
    } catch (failure) {
      const unknown = uncertain || !(failure instanceof DepositRequestError) || failure.uncertain;
      setUncertain(unknown);
      setError(unknown ? "Confirmation was interrupted. Keep this page open and retry the same request. Do not pay again." : failure instanceof Error ? failure.message : "Could not submit the deposit.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return { pending, busy, uncertain, error, prepare, reset, confirm };
}
