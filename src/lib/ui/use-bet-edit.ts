"use client";

import { useRef, useState } from "react";
import type { EditBetRequest } from "@/modules/betting/validators/edit-bet-input";
import type { PlayerBetDetailDTO } from "@/modules/betting/services/bet-read.service";
import type { EntryInput } from "@/modules/betting/validators/bet-input";

export class EditRequestError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}

export async function submitBetEdit(reference: string, request: EditBetRequest): Promise<PlayerBetDetailDTO> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/bets/${encodeURIComponent(reference)}`, {
      method: "PATCH", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.signal,
    });
    const body: { data?: { bet: PlayerBetDetailDTO }; error?: { message: string } } = await response.json();
    if (!response.ok || !body.data?.bet) throw new EditRequestError(body.error?.message ?? "Your changes could not be saved.", response.status >= 500 || response.ok);
    return body.data.bet;
  } finally { clearTimeout(timeout); }
}

/** Retain the exact request and id across ambiguous responses; never retry a different edit. */
export function useBetEdit(reference: string) {
  const [pending, setPending] = useState<EditBetRequest>();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string>();
  const [rejected, setRejected] = useState(false);
  const inFlight = useRef(false);
  const completed = useRef(false);

  function review(request: EntryInput & { stakePaise: number; expectedVersion: number }) {
    if (inFlight.current || uncertain || completed.current) return;
    setPending({ ...request, editRequestId: crypto.randomUUID() });
    setError(undefined); setRejected(false);
  }
  function back() {
    if (inFlight.current || uncertain || completed.current) return;
    setPending(undefined); setError(undefined); setRejected(false);
  }
  async function confirm() {
    if (inFlight.current || completed.current || !pending || rejected) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const bet = await submitBetEdit(reference, pending);
      completed.current = true; setUncertain(false);
      return bet;
    } catch (failure) {
      const unknownOutcome = uncertain || !(failure instanceof EditRequestError) || failure.uncertain;
      setUncertain(unknownOutcome); setRejected(!unknownOutcome);
      setError(unknownOutcome ? "Confirmation was interrupted. Keep this page open and retry the same edit to recover its result safely." : failure instanceof Error ? failure.message : "Changes could not be saved.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return { pending, busy, uncertain, error, rejected, review, back, confirm };
}
