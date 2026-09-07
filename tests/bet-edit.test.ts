import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { normalizeBetEntry } from "@/modules/betting/engines/normalize";
import { editBetRequestSchema, toEditEntryInput } from "@/modules/betting/validators/edit-bet-input";
import { betsListQuerySchema } from "@/modules/betting/validators/bet-query";
import {
  betEditWalletKey,
  compositionMatchesNormalized,
} from "@/modules/betting/services/bet-edit.service";
import {
  BET_LIST_MAX_LIMIT,
  clampBetListLimit,
  decodeBetCursor,
  encodeBetCursor,
  entryMetadataOf,
  ownedBetFilter,
  toBetRevisionDTO,
  toPlayerBetDTO,
} from "@/modules/betting/services/bet-read.service";

const MIN = 100;
const EDIT_REQUEST_ID = "22222222-2222-4222-8222-222222222222";

// --- edit-bet validator ----------------------------------------------------------------------

describe("editBetRequestSchema", () => {
  const jodi = {
    entryMethod: "JODI",
    numbers: ["07", "22"],
    stakePaise: 1000,
    expectedVersion: 1,
    editRequestId: EDIT_REQUEST_ID,
  };

  it("accepts a well-formed JODI / CROSSING / COPY_PASTE edit", () => {
    expect(editBetRequestSchema.safeParse(jodi).success).toBe(true);
    expect(
      editBetRequestSchema.safeParse({
        entryMethod: "CROSSING",
        digits: "428",
        stakePaise: 1000,
        expectedVersion: 3,
        editRequestId: EDIT_REQUEST_ID,
      }).success,
    ).toBe(true);
    expect(
      editBetRequestSchema.safeParse({
        entryMethod: "COPY_PASTE",
        rawInput: "22 15 48",
        palti: true,
        stakePaise: 1000,
        expectedVersion: 2,
        editRequestId: EDIT_REQUEST_ID,
      }).success,
    ).toBe(true);
  });

  it("rejects a missing / non-integer / below-1 expectedVersion", () => {
    expect(editBetRequestSchema.safeParse({ ...jodi, expectedVersion: undefined }).success).toBe(false);
    expect(editBetRequestSchema.safeParse({ ...jodi, expectedVersion: 0 }).success).toBe(false);
    expect(editBetRequestSchema.safeParse({ ...jodi, expectedVersion: 1.5 }).success).toBe(false);
  });

  it("rejects a missing or non-UUID editRequestId", () => {
    expect(editBetRequestSchema.safeParse({ ...jodi, editRequestId: undefined }).success).toBe(false);
    expect(editBetRequestSchema.safeParse({ ...jodi, editRequestId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects client-supplied authoritative / cross-method / re-market fields (.strict)", () => {
    expect(editBetRequestSchema.safeParse({ ...jodi, marketSlug: "faridabad" }).success).toBe(false);
    expect(editBetRequestSchema.safeParse({ ...jodi, clientRequestId: EDIT_REQUEST_ID }).success).toBe(false);
    expect(editBetRequestSchema.safeParse({ ...jodi, totalStakePaise: 2000 }).success).toBe(false);
    expect(editBetRequestSchema.safeParse({ ...jodi, version: 2 }).success).toBe(false);
    expect(editBetRequestSchema.safeParse({ ...jodi, digits: "428" }).success).toBe(false);
    expect(editBetRequestSchema.safeParse({ ...jodi, userId: "x" }).success).toBe(false);
  });

  it("toEditEntryInput narrows to the method-specific engine input", () => {
    expect(toEditEntryInput(editBetRequestSchema.parse(jodi))).toEqual({ entryMethod: "JODI", numbers: ["07", "22"] });
    expect(
      toEditEntryInput(
        editBetRequestSchema.parse({
          entryMethod: "COPY_PASTE",
          rawInput: "22,15",
          palti: false,
          stakePaise: 1000,
          expectedVersion: 1,
          editRequestId: EDIT_REQUEST_ID,
        }),
      ),
    ).toEqual({ entryMethod: "COPY_PASTE", rawInput: "22,15", palti: false });
  });
});

// --- bets list query -----------------------------------------------------------------------

describe("betsListQuerySchema", () => {
  it("defaults limit to 20 and rejects out-of-range / stray params", () => {
    expect(betsListQuerySchema.parse({}).limit).toBe(20);
    expect(betsListQuerySchema.parse({ limit: "5" }).limit).toBe(5);
    expect(betsListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(betsListQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(betsListQuerySchema.safeParse({ status: "PENDING" }).success).toBe(false);
    expect(betsListQuerySchema.safeParse({ nope: "1" }).success).toBe(false);
  });

  it("accepts the documented status and market filters", () => {
    expect(betsListQuerySchema.parse({ status: "ACTIVE" }).status).toBe("ACTIVE");
    expect(betsListQuerySchema.parse({ market: "Faridabad" }).market).toBe("faridabad");
  });
});

// --- wallet-key + canonical comparison ----------------------------------------------------

describe("betEditWalletKey", () => {
  it("is deterministic and encodes bet id, target version and direction", () => {
    const betId = new Types.ObjectId("0123456789abcdef01234567");
    expect(betEditWalletKey(betId, 2, "DEBIT")).toBe("BET_EDIT_DEBIT:0123456789abcdef01234567:v2");
    expect(betEditWalletKey(betId, 5, "REFUND")).toBe("BET_EDIT_REFUND:0123456789abcdef01234567:v5");
    expect(betEditWalletKey(betId, 2, "DEBIT")).toBe(betEditWalletKey(betId, 2, "DEBIT"));
  });
});

describe("compositionMatchesNormalized", () => {
  const normalized = normalizeBetEntry({ entryMethod: "JODI", numbers: ["07", "22", "48"] }, 1000, MIN);

  it("true for the same canonical wager, false for any difference", () => {
    expect(
      compositionMatchesNormalized(
        { entryMethod: "JODI", selections: [
          { number: "07", stakePaise: 1000 },
          { number: "22", stakePaise: 1000 },
          { number: "48", stakePaise: 1000 },
        ], totalStakePaise: 3000 },
        normalized,
      ),
    ).toBe(true);

    // different order
    expect(
      compositionMatchesNormalized(
        { entryMethod: "JODI", selections: [
          { number: "22", stakePaise: 1000 },
          { number: "07", stakePaise: 1000 },
          { number: "48", stakePaise: 1000 },
        ], totalStakePaise: 3000 },
        normalized,
      ),
    ).toBe(false);
    // different stake / total
    expect(
      compositionMatchesNormalized(
        { entryMethod: "JODI", selections: [{ number: "07", stakePaise: 3000 }], totalStakePaise: 3000 },
        normalized,
      ),
    ).toBe(false);
    // different method
    expect(
      compositionMatchesNormalized(
        { entryMethod: "COPY_PASTE", selections: normalized.selections, totalStakePaise: 3000 },
        normalized,
      ),
    ).toBe(false);
  });
});

// --- bet-read pure helpers -------------------------------------------------------------------

describe("clampBetListLimit", () => {
  it("undefined → 20, floors at 1, caps at the max, truncates", () => {
    expect(clampBetListLimit(undefined)).toBe(20);
    expect(clampBetListLimit(0)).toBe(1);
    expect(clampBetListLimit(-4)).toBe(1);
    expect(clampBetListLimit(999)).toBe(BET_LIST_MAX_LIMIT);
    expect(clampBetListLimit(7.9)).toBe(7);
  });
});

describe("bet list cursor", () => {
  it("round-trips (createdAt, _id) and rejects a malformed token as INVALID_INPUT", () => {
    const at = new Date("2026-09-06T12:00:00.000Z");
    const id = new Types.ObjectId();
    const token = encodeBetCursor(at, id);
    expect(decodeBetCursor(token)).toEqual({ t: at.getTime(), id: id.toHexString() });
    expect(() => decodeBetCursor("!!!not-base64!!!")).toThrow();
    try {
      decodeBetCursor("eyJ0IjoiYmFkIn0");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("INVALID_INPUT");
    }
  });
});

describe("ownedBetFilter", () => {
  const userId = new Types.ObjectId();

  it("uses _id for a 24-hex handle and an upper-cased publicRef otherwise", () => {
    const hex = "0123456789abcdef01234567";
    const byId = ownedBetFilter(userId, hex);
    expect(byId.userId).toBe(userId);
    expect((byId._id as Types.ObjectId).toHexString()).toBe(hex);
    expect(byId).not.toHaveProperty("publicRef");

    const byRef = ownedBetFilter(userId, " fb-0906-x7k29 ");
    expect(byRef.publicRef).toBe("FB-0906-X7K29");
    expect(byRef).not.toHaveProperty("_id");
  });
});

describe("entryMetadataOf", () => {
  it("rebuilds the by-method shape and never leaks other methods' keys", () => {
    expect(entryMetadataOf("JODI", { numbers: ["00", "07"] })).toEqual({ numbers: ["00", "07"] });
    expect(entryMetadataOf("CROSSING", { digits: "428" })).toEqual({ digits: "428" });
    expect(entryMetadataOf("COPY_PASTE", { rawInput: "22 15", palti: true })).toEqual({ rawInput: "22 15", palti: true });
    expect(entryMetadataOf("COPY_PASTE", { rawInput: "22 15" })).toEqual({ rawInput: "22 15", palti: false });
    expect(entryMetadataOf("JODI", { numbers: ["07"], digits: "9" } as never)).toEqual({ numbers: ["07"] });
  });
});

describe("toBetRevisionDTO", () => {
  it("exposes only the player-safe fields (no betId / userId / editRequestId / _id)", () => {
    const dto = toBetRevisionDTO({
      fromVersion: 1,
      toVersion: 2,
      before: { entryMethod: "JODI", entryMetadata: { numbers: ["07"] }, selections: [{ number: "07", stakePaise: 1000 }], totalStakePaise: 1000 },
      after: { entryMethod: "JODI", entryMetadata: { numbers: ["07", "22"] }, selections: [
        { number: "07", stakePaise: 1000 },
        { number: "22", stakePaise: 1000 },
      ], totalStakePaise: 2000 },
      walletDeltaPaise: -1000,
      editedAt: new Date("2026-09-06T10:00:00.000Z"),
    });
    expect(dto).toEqual({
      fromVersion: 1,
      toVersion: 2,
      before: { entryMethod: "JODI", entryMetadata: { numbers: ["07"] }, selections: [{ number: "07", stakePaise: 1000 }], totalStakePaise: 1000 },
      after: { entryMethod: "JODI", entryMetadata: { numbers: ["07", "22"] }, selections: [
        { number: "07", stakePaise: 1000 },
        { number: "22", stakePaise: 1000 },
      ], totalStakePaise: 2000 },
      walletDeltaPaise: -1000,
      editedAt: "2026-09-06T10:00:00.000Z",
    });
    expect(Object.keys(dto).sort()).toEqual(["after", "before", "editedAt", "fromVersion", "toVersion", "walletDeltaPaise"]);
  });
});

describe("toPlayerBetDTO", () => {
  const baseBet = {
    _id: new Types.ObjectId(),
    publicRef: "FB-0906-X7K29",
    entryMethod: "JODI",
    entryMetadata: { numbers: ["07", "22"] },
    selections: [
      { number: "07", stakePaise: 1000 },
      { number: "22", stakePaise: 1000 },
    ],
    totalSelections: 2,
    totalStakePaise: 2000,
    payoutMultiplierSnapshot: 90,
    status: "ACTIVE",
    version: 1,
    placedAt: new Date("2026-09-06T07:30:00.000Z"),
    lastEditedAt: null,
    winningNumber: null,
    payoutPaise: null,
    settledAt: null,
  };
  const market = { name: "Faridabad", slug: "faridabad", code: "FB", enabled: true };
  const round = {
    businessDate: "2026-09-06",
    opensAt: new Date("2026-09-06T01:30:00.000Z"),
    editCutoffAt: new Date("2026-09-06T11:20:00.000Z"),
    closesAt: new Date("2026-09-06T12:20:00.000Z"),
    result: null,
    settlementStatus: "PENDING" as const,
  };

  it("canEditNow is true well before cutoff and false past it", () => {
    expect(toPlayerBetDTO(baseBet, market, round, new Date("2026-09-06T09:00:00.000Z")).canEditNow).toBe(true);
    expect(toPlayerBetDTO(baseBet, market, round, new Date("2026-09-06T11:20:00.000Z")).canEditNow).toBe(false);
  });

  it("canEditNow is false for a non-ACTIVE bet even inside the window; outcome fields stay null", () => {
    const dto = toPlayerBetDTO({ ...baseBet, status: "WON" }, market, round, new Date("2026-09-06T09:00:00.000Z"));
    expect(dto.canEditNow).toBe(false);
    expect(dto.winningNumber).toBeNull();
    expect(dto.payoutPaise).toBeNull();
    expect(dto.settledAt).toBeNull();
  });

  it("never serializes internal foreign keys", () => {
    const dto = toPlayerBetDTO(baseBet, market, round, new Date("2026-09-06T09:00:00.000Z"));
    expect(dto).not.toHaveProperty("userId");
    expect(dto).not.toHaveProperty("marketId");
    expect(dto).not.toHaveProperty("marketRoundId");
    expect(dto).not.toHaveProperty("clientRequestId");
    expect(dto.businessDate).toBe("2026-09-06");
  });
});
