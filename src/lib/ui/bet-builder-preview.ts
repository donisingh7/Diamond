import { DomainError } from "@/lib/errors/domain-error";
import { rupeesToPaise, safeMultiply } from "@/lib/money";
import { generateCrossing } from "@/modules/betting/engines/crossing.engine";
import { parseCopyPaste } from "@/modules/betting/engines/copy-paste.engine";
import { expandPalti } from "@/modules/betting/engines/palti.engine";
import { dedupePreservingOrder } from "@/modules/betting/engines/selection";
import type { EntryInput } from "@/modules/betting/validators/bet-input";

export type SelectionPreview = {
  numbers: string[];
  uniqueDigits?: string[];
  parsedNumbers?: string[];
  error?: string;
};

/** Presentation only. Reuse the pure engines; never submit this as a server quote. */
export function previewSelections(entry: EntryInput): SelectionPreview {
  try {
    if (entry.entryMethod === "JODI") return { numbers: entry.numbers };
    if (entry.entryMethod === "CROSSING") {
      if (!entry.digits) return { numbers: [] };
      const result = generateCrossing(entry.digits);
      return { numbers: result.numbers, uniqueDigits: result.uniqueDigits };
    }
    if (!entry.rawInput) return { numbers: [] };
    const parsedNumbers = parseCopyPaste(entry.rawInput);
    return { parsedNumbers, numbers: entry.palti ? expandPalti(parsedNumbers) : dedupePreservingOrder(parsedNumbers) };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return { numbers: [], error: error.message };
  }
}

/** No configured minimum, balance, payout or eligibility claims belong in a local draft. */
export function previewStake(stake: string, count: number): { totalPaise?: number; error?: string } {
  if (!stake) return {};
  try {
    const paise = rupeesToPaise(stake);
    if (paise === 0) return { error: "Enter a stake greater than zero." };
    return { totalPaise: count ? safeMultiply(paise, count) : undefined };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return { error: error.code === "MONEY_OUT_OF_RANGE" ? "This amount is too large to preview safely. Enter a smaller stake." : "Enter rupees with up to two decimal places, such as 10 or 10.50." };
  }
}
