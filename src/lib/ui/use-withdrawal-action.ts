"use client";

import { useRef, useState } from "react";
import type { CreateWithdrawalRequest } from "@/modules/withdrawals/validators/withdrawal-input";
import type { WithdrawalReceipt } from "@/modules/withdrawals/services/withdrawal.service";

export type WithdrawalAction = { kind: "request"; request: CreateWithdrawalRequest } | { kind: "cancel"; id: string };
export class WithdrawalRequestError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}

export async function submitWithdrawalAction(action: WithdrawalAction): Promise<WithdrawalReceipt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(action.kind === "request" ? "/api/withdrawals" : `/api/withdrawals/${encodeURIComponent(action.id)}/cancel`, {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      ...(action.kind === "request" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(action.request) } : {}),
    });
    const body: { data?: WithdrawalReceipt; error?: { message: string } } = await response.json();
    if (!response.ok || !body.data?.withdrawal || !body.data.wallet) {
      throw new WithdrawalRequestError(body.error?.message ?? "The request could not be confirmed.", response.status >= 500 || response.ok);
    }
    return body.data;
  } finally { clearTimeout(timeout); }
}

/** An ambiguous response locks the original payload until its idempotent replay confirms it. */
export function useWithdrawalAction() {
  const [pending, setPending] = useState<WithdrawalAction>();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const completed = useRef(false);

  function prepare(action: WithdrawalAction) {
    if (inFlight.current || uncertain) return;
    completed.current = false; setPending(action); setError(undefined);
  }
  function reset() {
    if (inFlight.current || uncertain) return;
    completed.current = false; setPending(undefined); setError(undefined);
  }
  async function confirm() {
    if (!pending || inFlight.current || completed.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const receipt = await submitWithdrawalAction(pending);
      completed.current = true; setUncertain(false); setPending(undefined);
      return receipt;
    } catch (failure) {
      const unknownOutcome = uncertain || !(failure instanceof WithdrawalRequestError) || failure.uncertain;
      setUncertain(unknownOutcome);
      setError(unknownOutcome
        ? "Confirmation was interrupted. Keep this page open and retry the same action to recover its result."
        : failure instanceof Error ? failure.message : "The request could not be completed.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return { pending, busy, uncertain, error, prepare, reset, confirm };
}
