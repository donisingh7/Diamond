import "server-only";
import { Types, type ClientSession, type QueryFilter } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { getBettingWindow } from "@/lib/dates/market-time";
import { Market, type MarketRecord } from "@/modules/markets/models/market.model";
import { MarketRound, type MarketRoundRecord } from "@/modules/markets/models/market-round.model";
import { getMarketBySlug } from "@/modules/markets/services/market.service";
import { Bet, type BetDoc, type BetRecord, type BetRow } from "../models/bet.model";
import { BetRevision } from "../models/bet-revision.model";

/**
 * Player-facing bet reads — "My Bets" list and single-bet detail. Owner-only: `userId` always
 * comes from the authenticated session, never the client, and knowing a `publicRef` never grants
 * access (a non-owned or missing bet is an indistinguishable `BET_NOT_FOUND`). Nothing here
 * mutates state.
 *
 * Every authoritative value is server-derived from persisted state: `canEditNow` from the bet's
 * OWN round via the shared `getBettingWindow` helper (never the "current" round — a bet whose
 * round has already closed is not editable), `result` from the round, `payoutMultiplierSnapshot`
 * from the bet. Settlement is not built yet, so `winningNumber` / `payoutPaise` / `settledAt`
 * are `null` — never fabricated.
 */

export const BET_LIST_DEFAULT_LIMIT = 20;
export const BET_LIST_MAX_LIMIT = 50;
const HEX24 = /^[a-f0-9]{24}$/i;

export type BetSelectionDTO = { number: string; stakePaise: number };

/** The full wager composition — shared by a bet and by each revision's before / after snapshot. */
export type BetCompositionDTO = {
  entryMethod: string;
  entryMetadata: Record<string, unknown>;
  selections: BetSelectionDTO[];
  totalStakePaise: number;
};

/** Player-safe revision view — no `betId` / `userId` / `editRequestId` / Mongo `_id`. */
export type BetRevisionDTO = {
  fromVersion: number;
  toVersion: number;
  before: BetCompositionDTO;
  after: BetCompositionDTO;
  /** `before.totalStakePaise − after.totalStakePaise`: negative = wallet was debited, positive = refunded. */
  walletDeltaPaise: number;
  editedAt: string;
};

export type PlayerBetDTO = {
  id: string;
  publicRef: string;
  market: { name: string; slug: string; code: string };
  businessDate: string;
  entryMethod: string;
  entryMetadata: Record<string, unknown>;
  selections: BetSelectionDTO[];
  totalSelections: number;
  totalStakePaise: number;
  payoutMultiplierSnapshot: number;
  status: string;
  version: number;
  placedAt: string;
  lastEditedAt: string | null;
  editCutoffAt: string;
  closesAt: string;
  /** `true` only while the bet is ACTIVE and its own round is inside `[opensAt, editCutoffAt)`. */
  canEditNow: boolean;
  /** The market round's declared result, when present — not a per-bet outcome. */
  result: string | null;
  /** Per-bet settlement outcome. `null` until the settlement engine exists (never fabricated). */
  winningNumber: string | null;
  payoutPaise: number | null;
  settledAt: string | null;
};

export type PlayerBetDetailDTO = PlayerBetDTO & { revisions: BetRevisionDTO[] };

type MetadataShape = {
  numbers?: string[] | null;
  digits?: string | null;
  rawInput?: string | null;
  palti?: boolean | null;
};

/** The fields of a bet (hydrated doc or lean row) the DTO builder reads. */
export type BetSource = {
  _id: Types.ObjectId;
  publicRef: string;
  entryMethod: string;
  entryMetadata: MetadataShape | null | undefined;
  selections: readonly { number: string; stakePaise: number }[];
  totalSelections: number;
  totalStakePaise: number;
  payoutMultiplierSnapshot: number;
  status: string;
  version: number;
  placedAt: Date;
  lastEditedAt?: Date | null;
  winningNumber?: string | null;
  payoutPaise?: number | null;
  settledAt?: Date | null;
};

type MarketSource = Pick<MarketRecord, "name" | "slug" | "code" | "enabled">;
type RoundSource = Pick<
  MarketRoundRecord,
  "businessDate" | "opensAt" | "editCutoffAt" | "closesAt" | "result" | "settlementStatus"
>;

/** One wager composition as read from a bet or a revision snapshot (hydrated or lean). */
export type CompositionInput = {
  entryMethod: string;
  entryMetadata: MetadataShape | null | undefined;
  selections: readonly { number: string; stakePaise: number }[];
  totalStakePaise: number;
};

/** The fields of a `betRevisions` row the DTO builder reads (hydrated doc or lean row). */
export type BetRevisionSource = {
  fromVersion: number;
  toVersion: number;
  before: CompositionInput;
  after: CompositionInput;
  walletDeltaPaise: number;
  editedAt: Date;
};

/** Rebuild the persisted `entryMetadata` sub-document into its by-method DTO shape. */
export function entryMetadataOf(entryMethod: string, meta: MetadataShape | null | undefined): Record<string, unknown> {
  const m = meta ?? {};
  switch (entryMethod) {
    case "JODI":
      return { numbers: [...(m.numbers ?? [])] };
    case "CROSSING":
      return { digits: m.digits ?? "" };
    case "COPY_PASTE":
      return { rawInput: m.rawInput ?? "", palti: Boolean(m.palti) };
    default:
      return {};
  }
}

function selectionsOf(selections: readonly { number: string; stakePaise: number }[]): BetSelectionDTO[] {
  return selections.map((s) => ({ number: s.number, stakePaise: s.stakePaise }));
}

function compositionOf(composition: CompositionInput): BetCompositionDTO {
  return {
    entryMethod: composition.entryMethod,
    entryMetadata: entryMetadataOf(composition.entryMethod, composition.entryMetadata),
    selections: selectionsOf(composition.selections),
    totalStakePaise: composition.totalStakePaise,
  };
}

export function toBetRevisionDTO(row: BetRevisionSource): BetRevisionDTO {
  return {
    fromVersion: row.fromVersion,
    toVersion: row.toVersion,
    before: compositionOf(row.before),
    after: compositionOf(row.after),
    walletDeltaPaise: row.walletDeltaPaise,
    editedAt: row.editedAt.toISOString(),
  };
}

/** Build the player DTO from a bet plus its market + round (both already loaded). */
export function toPlayerBetDTO(bet: BetSource, market: MarketSource, round: RoundSource, now: Date): PlayerBetDTO {
  const canEditBet = getBettingWindow(
    market.enabled,
    {
      opensAt: round.opensAt,
      editCutoffAt: round.editCutoffAt,
      closesAt: round.closesAt,
      result: round.result ?? null,
      settlementStatus: round.settlementStatus,
    },
    now,
  ).canEditBet;
  return {
    id: bet._id.toString(),
    publicRef: bet.publicRef,
    market: { name: market.name, slug: market.slug, code: market.code },
    businessDate: round.businessDate,
    entryMethod: bet.entryMethod,
    entryMetadata: entryMetadataOf(bet.entryMethod, bet.entryMetadata),
    selections: selectionsOf(bet.selections),
    totalSelections: bet.totalSelections,
    totalStakePaise: bet.totalStakePaise,
    payoutMultiplierSnapshot: bet.payoutMultiplierSnapshot,
    status: bet.status,
    version: bet.version,
    placedAt: bet.placedAt.toISOString(),
    lastEditedAt: bet.lastEditedAt ? bet.lastEditedAt.toISOString() : null,
    editCutoffAt: round.editCutoffAt.toISOString(),
    closesAt: round.closesAt.toISOString(),
    canEditNow: bet.status === "ACTIVE" && canEditBet,
    result: round.result ?? null,
    winningNumber: bet.winningNumber ?? null,
    payoutPaise: bet.payoutPaise ?? null,
    settledAt: bet.settledAt ? bet.settledAt.toISOString() : null,
  };
}

// --- cursor (opaque base64url over the last row's (createdAt, _id)) ----------------------------

type DecodedCursor = { t: number; id: string };

export function encodeBetCursor(createdAt: Date, id: Types.ObjectId): string {
  return Buffer.from(JSON.stringify({ t: createdAt.getTime(), id: id.toHexString() })).toString("base64url");
}

export function decodeBetCursor(raw: string): DecodedCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" || parsed === null
      || typeof (parsed as DecodedCursor).t !== "number"
      || !Number.isFinite((parsed as DecodedCursor).t)
      || typeof (parsed as DecodedCursor).id !== "string"
      || !HEX24.test((parsed as DecodedCursor).id)
    ) {
      throw new Error("malformed cursor");
    }
    return { t: (parsed as DecodedCursor).t, id: (parsed as DecodedCursor).id };
  } catch {
    throw new DomainError("INVALID_INPUT", "Invalid pagination cursor.");
  }
}

export function clampBetListLimit(limit: number | undefined): number {
  if (limit === undefined) return BET_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), BET_LIST_MAX_LIMIT);
}

// --- reads ------------------------------------------------------------------------------------

/** Filter matching one of the caller's own bets by `id` handle (24-hex) or human `publicRef`. */
export function ownedBetFilter(userId: Types.ObjectId, idOrRef: string): QueryFilter<BetRecord> {
  const trimmed = idOrRef.trim();
  if (HEX24.test(trimmed)) return { userId, _id: new Types.ObjectId(trimmed) };
  return { userId, publicRef: trimmed.toUpperCase() };
}

/**
 * Resolve one of the caller's own bets (hydrated). A missing or non-owned bet is
 * `BET_NOT_FOUND` (404) — the two are deliberately indistinguishable, so knowing a `publicRef`
 * never confirms another player's bet exists.
 */
export async function resolveOwnedBet(
  userId: Types.ObjectId,
  idOrRef: string,
  session?: ClientSession,
): Promise<BetDoc> {
  const query = Bet.findOne(ownedBetFilter(userId, idOrRef));
  if (session) query.session(session);
  const bet = await query;
  if (!bet) throw new DomainError("BET_NOT_FOUND", "Bet not found.");
  return bet;
}

export type PlayerBetsPage = {
  bets: PlayerBetDTO[];
  /** Opaque cursor for the next (older) page, or `null` when the last page has been returned. */
  nextCursor: string | null;
};

export type ListPlayerBetsOptions = {
  limit?: number;
  cursor?: string;
  status?: "ACTIVE" | "WON" | "LOST";
  /** Market slug filter; resolved to an id, `MARKET_NOT_FOUND` if unknown. */
  market?: string;
};

/**
 * The caller's own bets, newest first, ALWAYS bounded (`limit` 1–50, default 20). Stable order
 * is `createdAt` desc then `_id` desc; the cursor carries the last row's `(createdAt, _id)` so
 * paging never skips or repeats a row even when timestamps collide. The page's markets and
 * rounds are batch-loaded (two `$in` reads), never one query per bet.
 */
export async function listPlayerBets(
  userId: Types.ObjectId,
  options: ListPlayerBetsOptions = {},
  now: Date = new Date(),
): Promise<PlayerBetsPage> {
  const limit = clampBetListLimit(options.limit);

  const filter: QueryFilter<BetRecord> = { userId };
  if (options.status) filter.status = options.status;
  if (options.market) filter.marketId = (await getMarketBySlug(options.market))._id;
  if (options.cursor) {
    const cursor = decodeBetCursor(options.cursor);
    const at = new Date(cursor.t);
    filter.$or = [
      { createdAt: { $lt: at } },
      { createdAt: at, _id: { $lt: new Types.ObjectId(cursor.id) } },
    ];
  }

  const rows = await Bet.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<BetRow[]>();

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeBetCursor(last.createdAt, last._id) : null;

  const marketIds = [...new Set(page.map((b) => b.marketId.toString()))].map((id) => new Types.ObjectId(id));
  const roundIds = [...new Set(page.map((b) => b.marketRoundId.toString()))].map((id) => new Types.ObjectId(id));
  const [markets, rounds] = await Promise.all([
    Market.find({ _id: { $in: marketIds } }).lean(),
    MarketRound.find({ _id: { $in: roundIds } }).lean(),
  ]);
  const marketById = new Map(markets.map((m) => [m._id.toString(), m]));
  const roundById = new Map(rounds.map((r) => [r._id.toString(), r]));

  const bets = page.flatMap((bet) => {
    const market = marketById.get(bet.marketId.toString());
    const round = roundById.get(bet.marketRoundId.toString());
    if (!market || !round) return [];
    return [toPlayerBetDTO(bet, market, round, now)];
  });

  return { bets, nextCursor };
}

/** One owned bet plus its full revision history (oldest first), for the ticket / edit screen. */
export async function getPlayerBetDetail(
  userId: Types.ObjectId,
  idOrRef: string,
  now: Date = new Date(),
): Promise<PlayerBetDetailDTO> {
  const bet = await Bet.findOne(ownedBetFilter(userId, idOrRef)).lean<BetRow>();
  if (!bet) throw new DomainError("BET_NOT_FOUND", "Bet not found.");
  const [market, round, revisions] = await Promise.all([
    Market.findById(bet.marketId).lean(),
    MarketRound.findById(bet.marketRoundId).lean(),
    BetRevision.find({ betId: bet._id }).sort({ toVersion: 1 }).lean(),
  ]);
  if (!market || !round) {
    throw new DomainError("INTERNAL_ERROR", "Bet market or round could not be loaded.");
  }
  return {
    ...toPlayerBetDTO(bet, market, round, now),
    revisions: revisions.map(toBetRevisionDTO),
  };
}
