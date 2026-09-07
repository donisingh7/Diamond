import { describe, expect, it } from "vitest";
import type { BetQuote } from "@/modules/betting/services/quote.service";
import { sameQuoteTerms } from "./use-bet-transaction";

const quote: BetQuote = {
  marketSlug: "test", marketId: "market", marketRoundId: "round", businessDate: "2026-09-08",
  marketState: "OPEN", entryMethod: "JODI", entryMetadata: { numbers: ["07"] }, engineMetadata: {},
  selections: [{ number: "07", stakePaise: 1000 }], selectionCount: 1, stakePerSelectionPaise: 1000,
  totalStakePaise: 1000, currency: "INR", payoutMultiplier: 90, perWinningSelectionCreditPaise: 90000,
  editCutoffAt: "2026-09-08T10:00:00Z", editableAfterPlacing: true, binding: false,
  serverNow: "2026-09-08T09:00:00Z",
};

describe("reviewed quote consent", () => {
  it("accepts a refreshed timestamp without requiring another confirmation", () => {
    expect(sameQuoteTerms(quote, { ...quote, serverNow: "2026-09-08T09:01:00Z" })).toBe(true);
  });
  it.each<Partial<BetQuote>>([
    { payoutMultiplier: 80, perWinningSelectionCreditPaise: 80000 },
    { marketRoundId: "next-round", businessDate: "2026-09-09" },
    { totalStakePaise: 2000 },
    { selections: [{ number: "70", stakePaise: 1000 }] },
    { selections: [{ number: "07", stakePaise: 2000 }] },
    { editableAfterPlacing: false },
  ])("requires renewed consent when server terms change: %j", changes => {
    expect(sameQuoteTerms(quote, { ...quote, ...changes })).toBe(false);
  });
});
