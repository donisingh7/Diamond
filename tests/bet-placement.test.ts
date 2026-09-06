import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_REF_ALPHABET,
  PUBLIC_REF_SUFFIX_LENGTH,
  businessDateRefComponent,
  generatePublicRef,
} from "@/modules/betting/services/public-ref";
import { betMatchesRequest } from "@/modules/betting/services/bet-placement.service";
import { normalizeBetEntry } from "@/modules/betting/engines/normalize";
import { placeBetRequestSchema } from "@/modules/betting/validators/place-bet-input";

const MIN = 100; // platformSettings.minimumStakePaise
const CLIENT_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

describe("generatePublicRef", () => {
  const REF = new RegExp(`^FB-0906-[${PUBLIC_REF_ALPHABET}]{${PUBLIC_REF_SUFFIX_LENGTH}}$`);

  it("is <MARKET CODE>-<MMDD>-<random 5> over the unambiguous alphabet", () => {
    expect(generatePublicRef("FB", "2026-09-06")).toMatch(REF);
    expect(generatePublicRef("fb", "2026-09-06")).toMatch(REF); // code is upper-cased
  });

  it("never emits the ambiguous glyphs I, O, 0 or 1 in the suffix", () => {
    expect(PUBLIC_REF_ALPHABET).not.toMatch(/[IO01]/);
    const suffixes = Array.from({ length: 500 }, () => generatePublicRef("FB", "2026-09-06").split("-")[2]).join("");
    expect(suffixes).not.toMatch(/[IO01]/);
  });

  it("derives the MMDD component from the business date", () => {
    expect(businessDateRefComponent("2026-09-06")).toBe("0906");
    expect(businessDateRefComponent("2026-01-07")).toBe("0107");
    expect(businessDateRefComponent("2026-12-31")).toBe("1231");
    expect(() => businessDateRefComponent("nope")).toThrow();
  });

  it("is collision-resistant across many generations for one market-day", () => {
    const refs = new Set(Array.from({ length: 5000 }, () => generatePublicRef("FB", "2026-09-06")));
    expect(refs.size).toBeGreaterThan(4990); // 31^5 space — near-zero duplicates
  });
});

describe("betMatchesRequest — canonical logical-wager idempotency comparison", () => {
  const marketId = new Types.ObjectId();
  const otherMarketId = new Types.ObjectId();
  const jodi = normalizeBetEntry({ entryMethod: "JODI", numbers: ["07", "22", "48"] }, 1000, MIN);

  const betFrom = (normalized: ReturnType<typeof normalizeBetEntry>, id: Types.ObjectId = marketId) => ({
    marketId: id,
    entryMethod: normalized.entryMethod,
    selections: normalized.selections.map((s) => ({ ...s })),
    totalSelections: normalized.selectionCount,
    totalStakePaise: normalized.totalStakePaise,
  });

  it("matches the identical wager", () => {
    expect(betMatchesRequest(betFrom(jodi), marketId, jodi)).toBe(true);
  });

  it("treats cosmetically different COPY_PASTE input that normalizes identically as the same wager", () => {
    const spaced = normalizeBetEntry({ entryMethod: "COPY_PASTE", rawInput: "22 15 48", palti: false }, 1000, MIN);
    const commas = normalizeBetEntry({ entryMethod: "COPY_PASTE", rawInput: "22,15,48", palti: false }, 1000, MIN);
    expect(betMatchesRequest(betFrom(spaced), marketId, commas)).toBe(true);
  });

  it("rejects a different stake, market, selection set or Palti expansion", () => {
    const biggerStake = normalizeBetEntry({ entryMethod: "JODI", numbers: ["07", "22", "48"] }, 2000, MIN);
    expect(betMatchesRequest(betFrom(jodi), marketId, biggerStake)).toBe(false);

    expect(betMatchesRequest(betFrom(jodi, otherMarketId), marketId, jodi)).toBe(false);

    const fewer = normalizeBetEntry({ entryMethod: "JODI", numbers: ["07", "22"] }, 1000, MIN);
    expect(betMatchesRequest(betFrom(jodi), marketId, fewer)).toBe(false);

    const noPalti = normalizeBetEntry({ entryMethod: "COPY_PASTE", rawInput: "15 48", palti: false }, 1000, MIN);
    const withPalti = normalizeBetEntry({ entryMethod: "COPY_PASTE", rawInput: "15 48", palti: true }, 1000, MIN);
    expect(betMatchesRequest(betFrom(noPalti), marketId, withPalti)).toBe(false);
  });
});

describe("placeBetRequestSchema", () => {
  const base = { marketSlug: "faridabad", stakePaise: 1000, clientRequestId: CLIENT_REQUEST_ID };

  it("accepts each entry method with a clientRequestId", () => {
    expect(placeBetRequestSchema.safeParse({ ...base, entryMethod: "JODI", numbers: ["07", "22"] }).success).toBe(true);
    expect(placeBetRequestSchema.safeParse({ ...base, entryMethod: "CROSSING", digits: "428935" }).success).toBe(true);
    expect(
      placeBetRequestSchema.safeParse({ ...base, entryMethod: "COPY_PASTE", rawInput: "2215489635", palti: true }).success,
    ).toBe(true);
  });

  it("requires a UUID clientRequestId", () => {
    expect(placeBetRequestSchema.safeParse({ ...base, entryMethod: "JODI", numbers: ["07"], clientRequestId: undefined }).success).toBe(false);
    expect(placeBetRequestSchema.safeParse({ ...base, entryMethod: "JODI", numbers: ["07"], clientRequestId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects client-supplied authoritative values and cross-method fields (.strict())", () => {
    for (const stray of [
      { totalStakePaise: 2000 },
      { selectionCount: 2 },
      { selections: [{ number: "07", stakePaise: 1000 }] },
      { payoutMultiplier: 90 },
      { marketRoundId: "64b7f9a2c1e4a2b3d4e5f6a7" },
      { publicRef: "FB-0906-X7K29" },
      { digits: "428" }, // cross-method
    ]) {
      expect(
        placeBetRequestSchema.safeParse({ ...base, entryMethod: "JODI", numbers: ["07"], ...stray }).success,
      ).toBe(false);
    }
  });
});
