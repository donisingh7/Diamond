import "server-only";
import { Types, type ClientSession, type QueryFilter } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import { hashPassword } from "@/lib/auth/password";
import { User, type UserRecord } from "@/modules/users/models/user.model";
import { normalizeLoginId } from "@/modules/users/validators/identity";
import { revokeAllUserSessions } from "@/modules/auth/services/session.service";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { Withdrawal } from "@/modules/withdrawals/models/withdrawal.model";
import {
  createPlayerWallet,
  isDuplicateKeyError,
  toWalletView,
  type WalletView,
} from "@/modules/wallet/services/wallet.service";
import { listPlayerBets, type ListPlayerBetsOptions, type PlayerBetsPage } from "@/modules/betting/services/bet-read.service";
import {
  listPlayerWithdrawals,
  type ListPlayerWithdrawalsOptions,
  type PlayerWithdrawalsPage,
} from "@/modules/withdrawals/services/withdrawal.service";
import { writeAuditLog } from "@/modules/audit/services/audit-log.service";

/**
 * Admin player management (Window 6A1). Every function here is ADMIN-only at the route layer;
 * the service additionally forces `role: "PLAYER"` on writes and refuses to act on an ADMIN
 * target — `resolvePlayer` returns an indistinguishable `PLAYER_NOT_FOUND` for a missing id OR
 * an ADMIN id, so admin accounts can never be enumerated or mutated through the player-management
 * surface (brief §29). There is no public signup path anywhere.
 *
 * `passwordHash` is `select:false` on the model and is never loaded, projected or returned by
 * anything in this file. Identity DTOs are hand-built allow-lists.
 */

export const PLAYER_LIST_DEFAULT_LIMIT = 25;
export const PLAYER_LIST_MAX_LIMIT = 100;

const HEX24 = /^[a-f0-9]{24}$/i;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- DTOs ----------------------------------------------------------------------------------

/** Sanitized identity — no `passwordHash`, no session/OTP material, no `createdBy`. */
export type AdminPlayerSummary = {
  id: string;
  loginId: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  updatedAt: string;
};

export type AdminPlayerListItem = AdminPlayerSummary & {
  availableBalancePaise: number;
  reservedBalancePaise: number;
  totalBalancePaise: number;
  betCount: number;
  withdrawalCount: number;
};

export type AdminPlayerDetail = AdminPlayerSummary & { wallet: WalletView };

type PlayerIdentityRow = {
  _id: Types.ObjectId;
  loginId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  status: "ACTIVE" | "DISABLED";
  createdAt: Date;
  updatedAt: Date;
};

export function toAdminPlayerSummary(user: PlayerIdentityRow): AdminPlayerSummary {
  return {
    id: user._id.toString(),
    loginId: user.loginId,
    name: user.name,
    phone: user.phone ?? null,
    email: user.email ?? null,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

// --- cursor (opaque base64url over the last row's (createdAt, _id)) ------------------------

type DecodedCursor = { t: number; id: string };

export function encodePlayerCursor(createdAt: Date, id: Types.ObjectId): string {
  return Buffer.from(JSON.stringify({ t: createdAt.getTime(), id: id.toHexString() })).toString("base64url");
}

export function decodePlayerCursor(raw: string): DecodedCursor {
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

export function clampPlayerListLimit(limit: number | undefined): number {
  if (limit === undefined) return PLAYER_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), PLAYER_LIST_MAX_LIMIT);
}

// --- resolve -----------------------------------------------------------------------------

/**
 * A hydrated PLAYER by 24-hex id. A missing id, a malformed id and an ADMIN id are all the same
 * `PLAYER_NOT_FOUND` — knowing an id never confirms an account exists, and ADMIN accounts are
 * invisible to player management (brief §29).
 */
export async function resolvePlayer(playerId: string, session?: ClientSession) {
  const trimmed = playerId.trim();
  if (!HEX24.test(trimmed)) throw new DomainError("PLAYER_NOT_FOUND", "Player not found.");
  const query = User.findOne({ _id: new Types.ObjectId(trimmed), role: "PLAYER" });
  if (session) query.session(session);
  const user = await query;
  if (!user) throw new DomainError("PLAYER_NOT_FOUND", "Player not found.");
  return user;
}

// --- create ----------------------------------------------------------------------------

export type CreatePlayerServiceInput = {
  actorAdminId: Types.ObjectId;
  loginId: string;
  name: string;
  password: string;
  phone?: string;
  email?: string;
};

/**
 * Create a PLAYER + its ₹0 wallet + a `PLAYER_CREATED` audit row in one MongoDB transaction.
 * Role is server-forced PLAYER, status ACTIVE, `createdBy` is the acting admin. No opening
 * balance — any real starting balance is a separate, audited `ADMIN_CREDIT` movement.
 */
export async function createPlayer(input: CreatePlayerServiceInput): Promise<AdminPlayerDetail> {
  const loginId = normalizeLoginId(input.loginId);
  const phone = input.phone?.trim() || undefined;
  const email = input.email?.trim().toLowerCase() || undefined;

  if (await User.exists({ loginId })) {
    throw new DomainError("LOGIN_ID_TAKEN", "That login ID is already in use.");
  }
  if (phone && (await User.exists({ phone }))) {
    throw new DomainError("IDENTIFIER_TAKEN", "That phone number is already registered.");
  }
  if (email && (await User.exists({ email }))) {
    throw new DomainError("IDENTIFIER_TAKEN", "That email address is already registered.");
  }

  const passwordHash = await hashPassword(input.password);
  const playerId = new Types.ObjectId();

  try {
    await withTransaction(async (session) => {
      await User.create(
        [
          {
            _id: playerId,
            role: "PLAYER",
            loginId,
            name: input.name.trim(),
            ...(phone ? { phone } : {}),
            ...(email ? { email } : {}),
            passwordHash,
            status: "ACTIVE",
            createdBy: input.actorAdminId,
            passwordChangedAt: new Date(),
          },
        ],
        { session },
      );
      await createPlayerWallet(playerId, session);
      await writeAuditLog(
        {
          actorAdminId: input.actorAdminId,
          action: "PLAYER_CREATED",
          entityType: "User",
          entityId: playerId,
          subjectUserId: playerId,
          after: { loginId, name: input.name.trim(), role: "PLAYER", status: "ACTIVE", phone: phone ?? null, email: email ?? null },
        },
        session,
      );
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      if (await User.exists({ loginId })) {
        throw new DomainError("LOGIN_ID_TAKEN", "That login ID is already in use.");
      }
      throw new DomainError("IDENTIFIER_TAKEN", "That phone or email is already registered.");
    }
    throw error;
  }

  return getPlayerDetail(playerId.toHexString());
}

// --- list ------------------------------------------------------------------------------

export type ListPlayersServiceOptions = {
  search?: string;
  status?: "ACTIVE" | "DISABLED";
  limit?: number;
  cursor?: string;
};

export type AdminPlayersPage = { players: AdminPlayerListItem[]; nextCursor: string | null };

/**
 * PLAYER accounts only, newest first, ALWAYS bounded (`limit` 1–100, default 25). Stable order
 * is `createdAt` desc then `_id` desc; the opaque cursor carries the last row's `(createdAt, _id)`.
 * `search` matches the NORMALIZED identity fields only — `loginId` / `email` (case-insensitive
 * substring) and `phone` (exact) — never `name` or any hashed field. Wallet balances and the
 * bet / withdrawal counts are batch-loaded (three `$in` reads total, no per-row query).
 */
export async function listPlayers(options: ListPlayersServiceOptions = {}): Promise<AdminPlayersPage> {
  const limit = clampPlayerListLimit(options.limit);

  const and: Record<string, unknown>[] = [];
  if (options.search) {
    const raw = options.search.trim();
    const contains = new RegExp(escapeRegex(normalizeLoginId(raw)), "i");
    and.push({ $or: [{ loginId: contains }, { email: contains }, { phone: raw }] });
  }
  if (options.cursor) {
    const cursor = decodePlayerCursor(options.cursor);
    const at = new Date(cursor.t);
    and.push({
      $or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: new Types.ObjectId(cursor.id) } }],
    });
  }

  const filter: QueryFilter<UserRecord> = { role: "PLAYER" };
  if (options.status) filter.status = options.status;
  if (and.length) filter.$and = and;

  const rows = await User.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<PlayerIdentityRow[]>();

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodePlayerCursor(last.createdAt, last._id) : null;

  const ids = page.map((row) => row._id);
  const [wallets, betCounts, withdrawalCounts] = await Promise.all([
    Wallet.find({ userId: { $in: ids } }).lean(),
    Bet.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { userId: { $in: ids } } },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ]),
    Withdrawal.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { userId: { $in: ids } } },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ]),
  ]);
  const walletByUser = new Map(wallets.map((w) => [w.userId.toString(), w]));
  const betCountByUser = new Map(betCounts.map((c) => [c._id.toString(), c.count]));
  const withdrawalCountByUser = new Map(withdrawalCounts.map((c) => [c._id.toString(), c.count]));

  const players = page.map((row) => {
    const wallet = walletByUser.get(row._id.toString());
    const view = toWalletView(
      wallet ?? { currency: "INR", availableBalancePaise: 0, reservedBalancePaise: 0 },
    );
    return {
      ...toAdminPlayerSummary(row),
      availableBalancePaise: view.availableBalancePaise,
      reservedBalancePaise: view.reservedBalancePaise,
      totalBalancePaise: view.totalBalancePaise,
      betCount: betCountByUser.get(row._id.toString()) ?? 0,
      withdrawalCount: withdrawalCountByUser.get(row._id.toString()) ?? 0,
    };
  });

  return { players, nextCursor };
}

// --- detail ----------------------------------------------------------------------------

/** Sanitized identity + live wallet view (a ₹0 wallet is created on the fly if missing). */
export async function getPlayerDetail(playerId: string): Promise<AdminPlayerDetail> {
  const trimmed = playerId.trim();
  if (!HEX24.test(trimmed)) throw new DomainError("PLAYER_NOT_FOUND", "Player not found.");
  const row = await User.findOne({ _id: new Types.ObjectId(trimmed), role: "PLAYER" }).lean<PlayerIdentityRow>();
  if (!row) throw new DomainError("PLAYER_NOT_FOUND", "Player not found.");
  const wallet = await createPlayerWallet(row._id);
  return { ...toAdminPlayerSummary(row), wallet: toWalletView(wallet) };
}

// --- enable / disable ----------------------------------------------------------------

export type PlayerStatusServiceInput = { actorAdminId: Types.ObjectId; playerId: string };

/**
 * `ACTIVE → DISABLED`, then every one of the player's sessions is revoked in the same
 * transaction — the next protected request fails, and `findActiveSessionUser` also rejects any
 * surviving cookie because the user is no longer ACTIVE. Historical data (wallet, bets,
 * withdrawals, ledger) is untouched; the user is NOT deleted. Repeating a disable is a safe
 * no-op that writes no second audit row.
 */
export async function disablePlayer(input: PlayerStatusServiceInput): Promise<AdminPlayerDetail> {
  const user = await resolvePlayer(input.playerId);
  if (user.status === "DISABLED") {
    await revokeAllUserSessions(user._id);
    return getPlayerDetail(input.playerId);
  }
  await withTransaction(async (session) => {
    const res = await User.updateOne(
      { _id: user._id, role: "PLAYER", status: "ACTIVE" },
      { $set: { status: "DISABLED" } },
      { session },
    );
    if (res.matchedCount !== 1) return;
    await revokeAllUserSessions(user._id, session);
    await writeAuditLog(
      {
        actorAdminId: input.actorAdminId,
        action: "PLAYER_DISABLED",
        entityType: "User",
        entityId: user._id,
        subjectUserId: user._id,
        before: { status: "ACTIVE" },
        after: { status: "DISABLED" },
      },
      session,
    );
  });
  return getPlayerDetail(input.playerId);
}

/**
 * `DISABLED → ACTIVE`. Old sessions are NOT recreated — the player must log in again. Repeating
 * an enable is a safe no-op that writes no second audit row.
 */
export async function enablePlayer(input: PlayerStatusServiceInput): Promise<AdminPlayerDetail> {
  const user = await resolvePlayer(input.playerId);
  if (user.status === "ACTIVE") return getPlayerDetail(input.playerId);
  await withTransaction(async (session) => {
    const res = await User.updateOne(
      { _id: user._id, role: "PLAYER", status: "DISABLED" },
      { $set: { status: "ACTIVE" } },
      { session },
    );
    if (res.matchedCount !== 1) return;
    await writeAuditLog(
      {
        actorAdminId: input.actorAdminId,
        action: "PLAYER_ENABLED",
        entityType: "User",
        entityId: user._id,
        subjectUserId: user._id,
        before: { status: "DISABLED" },
        after: { status: "ACTIVE" },
      },
      session,
    );
  });
  return getPlayerDetail(input.playerId);
}

export function setPlayerStatus(
  input: PlayerStatusServiceInput & { status: "ACTIVE" | "DISABLED" },
): Promise<AdminPlayerDetail> {
  return input.status === "DISABLED" ? disablePlayer(input) : enablePlayer(input);
}

// --- password reset -----------------------------------------------------------------

export type ResetPlayerPasswordServiceInput = PlayerStatusServiceInput & { newPassword: string };

/**
 * Hash a new password onto the PLAYER, stamp `passwordChangedAt`, and revoke every existing
 * session in the same transaction so the player must sign in again with the new credential. The
 * hash is never returned and the audit row records no password material. This is NOT a player
 * self-service change-password flow.
 */
export async function resetPlayerPassword(input: ResetPlayerPasswordServiceInput): Promise<{ ok: true }> {
  const user = await resolvePlayer(input.playerId);
  const passwordHash = await hashPassword(input.newPassword);
  await withTransaction(async (session) => {
    await User.updateOne(
      { _id: user._id, role: "PLAYER" },
      { $set: { passwordHash, passwordChangedAt: new Date() } },
      { session },
    );
    await revokeAllUserSessions(user._id, session);
    await writeAuditLog(
      {
        actorAdminId: input.actorAdminId,
        action: "PLAYER_PASSWORD_RESET",
        entityType: "User",
        entityId: user._id,
        subjectUserId: user._id,
      },
      session,
    );
  });
  return { ok: true };
}

// --- wallet read helper (balances only) --------------------------------------------

/** Admin view of a player's wallet balances (ensures a ₹0 wallet exists; never grants funds). */
export async function getPlayerWalletView(playerId: string): Promise<WalletView> {
  const user = await resolvePlayer(playerId);
  return toWalletView(await createPlayerWallet(user._id));
}

// --- linked reads (bets / withdrawals) — REUSE the sanitized player services --------------

/**
 * A player's bets for the admin screen. Reuses the exact player-facing `listPlayerBets` (owner
 * scope = the resolved player, sanitized DTO — no internal metadata, no wallet secrets). Admin
 * inspects only; there is NO admin bet edit / delete path anywhere (brief §23).
 */
export async function listPlayerBetsForAdmin(
  playerId: string,
  options: ListPlayerBetsOptions = {},
  now: Date = new Date(),
): Promise<PlayerBetsPage> {
  const user = await resolvePlayer(playerId);
  return listPlayerBets(user._id, options, now);
}

/**
 * A player's withdrawals for the admin screen. Reuses the player-facing `listPlayerWithdrawals`
 * (sanitized DTO — masked `destination.summary` only, never raw `paymentDetails`). Admin
 * approve / reject is Window 6A2, not here.
 */
export async function listPlayerWithdrawalsForAdmin(
  playerId: string,
  options: ListPlayerWithdrawalsOptions = {},
): Promise<PlayerWithdrawalsPage> {
  const user = await resolvePlayer(playerId);
  return listPlayerWithdrawals(user._id, options);
}
