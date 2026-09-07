import "server-only";
import { Types, type QueryFilter } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { User } from "@/modules/users/models/user.model";
import { Market } from "@/modules/markets/models/market.model";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import { getMarketBySlug } from "@/modules/markets/services/market.service";
import { Bet, type BetRecord, type BetRow } from "@/modules/betting/models/bet.model";
import { BetRevision } from "@/modules/betting/models/bet-revision.model";
import {
  toBetRevisionDTO,
  toPlayerBetDTO,
  type BetRevisionDTO,
  type PlayerBetDTO,
} from "@/modules/betting/services/bet-read.service";
import { clampLimit, decodeCursor, encodeCursor, olderThan } from "./pagination";

/**
 * Admin global bet reads (Window 6A2) — READ ONLY. Reuses the sanitized player bet DTO +
 * revision DTO and adds a player summary. There is NO admin path anywhere to edit a bet, delete
 * a bet, mutate a revision, or change a selection / stake — immutable history is preserved.
 */

const HEX24 = /^[a-f0-9]{24}$/i;
export const ADMIN_BET_LIST_DEFAULT_LIMIT = 20;
export const ADMIN_BET_LIST_MAX_LIMIT = 50;

export type AdminBetPlayer = { id: string; loginId: string; name: string };
export type AdminBetDTO = PlayerBetDTO & { player: AdminBetPlayer };
export type AdminBetDetailDTO = AdminBetDTO & { revisions: BetRevisionDTO[] };

const UNKNOWN_PLAYER = (id: Types.ObjectId): AdminBetPlayer => ({
  id: id.toString(),
  loginId: "(deleted)",
  name: "(deleted player)",
});

async function playersByIds(ids: Types.ObjectId[]): Promise<Map<string, AdminBetPlayer>> {
  if (ids.length === 0) return new Map();
  const rows = await User.find({ _id: { $in: ids } })
    .select({ loginId: 1, name: 1 })
    .lean<{ _id: Types.ObjectId; loginId: string; name: string }[]>();
  return new Map(rows.map((r) => [r._id.toString(), { id: r._id.toString(), loginId: r.loginId, name: r.name }]));
}

export type ListBetsForAdminOptions = {
  playerId?: string;
  market?: string;
  status?: "ACTIVE" | "WON" | "LOST";
  entryMethod?: "JODI" | "CROSSING" | "COPY_PASTE";
  businessDate?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  cursor?: string;
};

export type AdminBetsPage = { bets: AdminBetDTO[]; nextCursor: string | null };

/**
 * Every bet, newest first, ALWAYS bounded (`limit` 1–50, default 20). Stable `(createdAt, _id)`
 * desc cursor. Filters: `playerId`, `market` (slug → id, `MARKET_NOT_FOUND` if unknown),
 * `status`, `entryMethod`, `businessDate` (resolved to that day's round ids), and a
 * `dateFrom`/`dateTo` window on `createdAt`. Markets / rounds / players are batch-loaded — no N+1.
 */
export async function listBetsForAdmin(options: ListBetsForAdminOptions = {}, now: Date = new Date()): Promise<AdminBetsPage> {
  const limit = clampLimit(options.limit, ADMIN_BET_LIST_DEFAULT_LIMIT, ADMIN_BET_LIST_MAX_LIMIT);

  const filter: QueryFilter<BetRecord> = {};
  if (options.playerId) {
    if (!HEX24.test(options.playerId.trim())) return { bets: [], nextCursor: null };
    filter.userId = new Types.ObjectId(options.playerId.trim());
  }
  if (options.status) filter.status = options.status;
  if (options.entryMethod) filter.entryMethod = options.entryMethod;
  if (options.market) filter.marketId = (await getMarketBySlug(options.market))._id;
  if (options.businessDate) {
    const roundIds = await MarketRound.find({ businessDate: options.businessDate })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>();
    if (roundIds.length === 0) return { bets: [], nextCursor: null };
    filter.marketRoundId = { $in: roundIds.map((r) => r._id) };
  }

  const and: Record<string, unknown>[] = [];
  const createdAt: Record<string, Date> = {};
  if (options.dateFrom) createdAt.$gte = new Date(options.dateFrom);
  if (options.dateTo) createdAt.$lte = new Date(options.dateTo);
  if (Object.keys(createdAt).length) and.push({ createdAt });
  if (options.cursor) and.push({ $or: olderThan("createdAt", decodeCursor(options.cursor)) });
  if (and.length) filter.$and = and;

  const rows = await Bet.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<BetRow[]>();

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeCursor(last.createdAt, last._id) : null;

  const marketIds = [...new Set(page.map((b) => b.marketId.toString()))].map((id) => new Types.ObjectId(id));
  const roundIds = [...new Set(page.map((b) => b.marketRoundId.toString()))].map((id) => new Types.ObjectId(id));
  const userIds = [...new Set(page.map((b) => b.userId.toString()))].map((id) => new Types.ObjectId(id));
  const [markets, rounds, players] = await Promise.all([
    Market.find({ _id: { $in: marketIds } }).lean(),
    MarketRound.find({ _id: { $in: roundIds } }).lean(),
    playersByIds(userIds),
  ]);
  const marketById = new Map(markets.map((m) => [m._id.toString(), m]));
  const roundById = new Map(rounds.map((r) => [r._id.toString(), r]));

  const bets = page.flatMap((bet) => {
    const market = marketById.get(bet.marketId.toString());
    const round = roundById.get(bet.marketRoundId.toString());
    if (!market || !round) return [];
    return [{
      ...toPlayerBetDTO(bet, market, round, now),
      player: players.get(bet.userId.toString()) ?? UNKNOWN_PLAYER(bet.userId),
    }];
  });
  return { bets, nextCursor };
}

/**
 * One bet by 24-hex `_id` or human `publicRef` (no owner scope — admin sees all), plus its full
 * revision history (oldest first). READ ONLY. A missing / malformed handle is `BET_NOT_FOUND`.
 */
export async function getBetDetailForAdmin(idOrRef: string, now: Date = new Date()): Promise<AdminBetDetailDTO> {
  const trimmed = idOrRef.trim();
  const query = HEX24.test(trimmed)
    ? { _id: new Types.ObjectId(trimmed) }
    : { publicRef: trimmed.toUpperCase() };
  const bet = await Bet.findOne(query).lean<BetRow>();
  if (!bet) throw new DomainError("BET_NOT_FOUND", "Bet not found.");

  const [market, round, revisions, players] = await Promise.all([
    Market.findById(bet.marketId).lean(),
    MarketRound.findById(bet.marketRoundId).lean(),
    BetRevision.find({ betId: bet._id }).sort({ toVersion: 1 }).lean(),
    playersByIds([bet.userId]),
  ]);
  if (!market || !round) throw new DomainError("INTERNAL_ERROR", "Bet market or round could not be loaded.");

  return {
    ...toPlayerBetDTO(bet, market, round, now),
    player: players.get(bet.userId.toString()) ?? UNKNOWN_PLAYER(bet.userId),
    revisions: revisions.map(toBetRevisionDTO),
  };
}
