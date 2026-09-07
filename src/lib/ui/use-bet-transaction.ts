"use client";

import { useRef, useState } from "react";
import type { BetQuote } from "@/modules/betting/services/quote.service";
import type { BetPlacementReceipt } from "@/modules/betting/services/bet-placement.service";
import type { QuoteRequest } from "@/modules/betting/validators/quote-input";

class RequestError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}

async function post<T>(url: string, request: object): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.signal });
    const body: { data?: T; error?: { message: string } } = await response.json();
    if (!response.ok || !body.data) throw new RequestError(body.error?.message ?? "The request could not be completed.", response.status >= 500 || response.ok);
    return body.data;
  } finally { clearTimeout(timeout); }
}

/** Compare reviewed terms, excluding server timestamps and changing lifecycle labels. */
export function sameQuoteTerms(a: BetQuote, b: BetQuote) {
  return a.marketRoundId === b.marketRoundId && a.businessDate === b.businessDate
    && a.entryMethod === b.entryMethod && a.currency === b.currency
    && a.selectionCount === b.selectionCount && a.stakePerSelectionPaise === b.stakePerSelectionPaise
    && a.totalStakePaise === b.totalStakePaise && a.payoutMultiplier === b.payoutMultiplier
    && a.perWinningSelectionCreditPaise === b.perWinningSelectionCreditPaise
    && a.editableAfterPlacing === b.editableAfterPlacing && a.editCutoffAt === b.editCutoffAt
    && a.selections.length === b.selections.length
    && a.selections.every((selection, index) => selection.number === b.selections[index].number && selection.stakePaise === b.selections[index].stakePaise);
}

export function useBetTransaction() {
  const [draft, setDraft] = useState<QuoteRequest>();
  const [quote, setQuote] = useState<BetQuote>();
  const [receipt, setReceipt] = useState<BetPlacementReceipt>();
  const [phase, setPhase] = useState<"idle" | "quoting" | "placing">("idle");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const requestId = useRef<string | undefined>(undefined);
  const completed = useRef(false);

  async function review(request: QuoteRequest) {
    if (busy.current || uncertain || completed.current) return;
    busy.current = true;
    setDraft(request); setQuote(undefined); setError(undefined); setNotice(undefined); setPhase("quoting");
    try { setQuote(await post<BetQuote>("/api/bets/quote", request)); }
    catch (error) { setError(error instanceof RequestError ? error.message : "Connection interrupted. Try refreshing the quote."); }
    finally { busy.current = false; setPhase("idle"); }
  }

  async function confirm() {
    if (busy.current || completed.current || !draft || !quote) return;
    busy.current = true;
    setError(undefined); setNotice(undefined);
    let placing = false;
    try {
      // An ambiguous placement must replay its exact request, even after market close.
      if (!uncertain) {
        setPhase("quoting");
        const fresh = await post<BetQuote>("/api/bets/quote", draft);
        setQuote(fresh);
        if (!sameQuoteTerms(quote, fresh)) {
          setNotice("Your quote has changed. Review the updated details before confirming again.");
          return;
        }
      }
      requestId.current ??= crypto.randomUUID();
      placing = true;
      setPhase("placing");
      const result = await post<BetPlacementReceipt>("/api/bets", { ...draft, clientRequestId: requestId.current });
      completed.current = true;
      setReceipt(result); setUncertain(false);
    } catch (error) {
      // Once a response is lost, later errors cannot prove that the first attempt failed.
      const unknownOutcome = uncertain || (placing && (!(error instanceof RequestError) || error.uncertain));
      setUncertain(unknownOutcome);
      if (!unknownOutcome) setQuote(undefined);
      setError(unknownOutcome
        ? "Confirmation could not be received. Retry this same bet to recover its ticket safely. Keep this page open; do not start another bet."
        : error instanceof RequestError ? error.message : "Connection interrupted. Refresh the quote and try again.");
    } finally { busy.current = false; setPhase("idle"); }
  }

  function edit() {
    if (busy.current || uncertain || completed.current) return;
    setDraft(undefined); setQuote(undefined); setError(undefined); setNotice(undefined); requestId.current = undefined;
  }

  return { draft, quote, receipt, phase, error, notice, uncertain, review, confirm, edit };
}
