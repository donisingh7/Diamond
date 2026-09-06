import "server-only";
import { Types } from "mongoose";
import { DomainError, type ErrorCode } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import { getBettingWindow, type MarketAvailabilityReason } from "@/lib/dates/market-time";
import { Market } from "@/modules/markets/models/market.model";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import {
  getMarketBySlug,
  resolveCurrentRound,
  roundStateOf,
  type MarketDoc,
  type MarketRoundDoc,
} from "@/modules/markets/services/market.service";
import { getPlatformSettings } from "@/modules/settings/services/platform-settings.service";
import {
  createPlayerWallet,
  debitAvailableInSession,
  getWalletView,
  isDuplicateKeyError,
  type WalletView,
} from "@/modules/wallet/services/wallet.service";
import { normalizeBetEntry } from "../engines/normalize";
import type { NormalizedBetEntry } from "../engines/types";
import { Bet, type BetDoc } from "../models/bet.model";
import { toPlaceEntryInput, type PlaceBetRequest } from "../validators/place-bet-input";
import { generatePublicRef, PUBLIC_REF_MAX_ATTEMPTS, type PublicRefGenerator } from "./public-ref";

/**
 * Bet placement — the server-authoritative, financially atomic confirmation of a player wager.
 *
 * A quote is NON-BINDING: nothing here trusts a prior quote. Every value is recomputed —
 * selections and totals from the shared engines, the market/round state from the Window 3A
 * services, the payout multiplier from the persisted platform singleton, the wallet balance
 * from the ledger. One MongoDB transaction contains the `Bet` insert, the available-balance
 * debit and the immutable `BET_PLACED` ledger row; there is no partial-success state.
 *
 * Layering: API → Zod → `placeBet` → { shared normalization engine · market/round service ·
 * platform settings · wallet transaction primitive } → one Mongo transaction. The wallet never
 * imports betting; betting depends on the wallet.
 */

export type PlaceBetInput = {
  userId: Types.ObjectId;
  request: PlaceBetRequest;
};

/** Test seams — production passes neither. */
export type PlaceBetOptions = {
  /** Authoritative time source. Called again inside the transaction so a retry that lands
   *  after the market has actually closed cannot create a bet. */
  clock?: () => Date;
  /** Public-reference generator; overridable to force a persistence failure or a collision. */
  generatePublicRef?: PublicRefGenerator;
};

export type BetPlacementReceipt = {
  bet: {
    id: string;
    publicRef: string;
    market: { name: string; slug: string; code: string };
    businessDate: string;
    entryMethod: string;
    entryMetadata: Record<string, unknown>;
    selections: { number: string; stakePaise: number }[];
    totalSelections: number;
    totalStakePaise: number;
    payoutMultiplierSnapshot: number;
    status: string;
    version: number;
    placedAt: string;
    editCutoffAt: string;
    closesAt: string;
    /** Whether this bet is editable right now (`false` in the edit-locked CLOSING_SOON window;
     *  a placement there is still valid — the bet is simply immediately non-editable). */
    canEditNow: boolean;
  };
  wallet: { currency: string; availableBalancePaise: number; reservedBalancePaise: number };
  serverNow: string;
};

const PLACEMENT_BLOCK: Record<MarketAvailabilityReason, { code: ErrorCode; message: string }> = {
  MARKET_DISABLED: { code: "MARKET_DISABLED", message: "This market is disabled." },
  ROUND_NOT_FOUND: { code: "ROUND_NOT_FOUND", message: "This market has no round open for betting." },
  MARKET_NOT_OPEN: { code: "MARKET_NOT_OPEN", message: "This market is not open for betting yet." },
  MARKET_CLOSED: { code: "MARKET_CLOSED", message: "This market is closed for new bets." },
  // Placement is allowed through the edit-locked interval, so this never actually blocks it;
  // mapped defensively for exhaustiveness.
  EDIT_WINDOW_CLOSED: { code: "MARKET_CLOSED", message: "This market is closed for new bets." },
};

function blocked(reason: MarketAvailabilityReason): DomainError {
  const { code, message } = PLACEMENT_BLOCK[reason];
  return new DomainError(code, message);
}

/** The stored fields a canonical-wager comparison needs — a hydrated `BetDoc` satisfies it. */
export type StoredWager = {
  marketId: Types.ObjectId;
  entryMethod: string;
  selections: readonly { number: string; stakePaise: number }[];
  totalSelections: number;
  totalStakePaise: number;
};

/** Canonical logical-wager comparison for idempotency: same market, method, ordered canonical
 *  selections and stake (which also captures Palti — it changes the selection set). Cosmetic
 *  differences in the raw input that normalize to the same wager are treated as equal. */
export function betMatchesRequest(
  bet: StoredWager,
  marketId: Types.ObjectId,
  normalized: NormalizedBetEntry,
): boolean {
  if (!bet.marketId.equals(marketId)) return false;
  if (bet.entryMethod !== normalized.entryMethod) return false;
  if (bet.totalStakePaise !== normalized.totalStakePaise) return false;
  if (bet.totalSelections !== normalized.selectionCount) return false;
  if (bet.selections.length !== normalized.selections.length) return false;
  return bet.selections.every(
    (selection, index) =>
      selection.number === normalized.selections[index].number
      && selection.stakePaise === normalized.selections[index].stakePaise,
  );
}

function entryMetadataDTO(bet: BetDoc): Record<string, unknown> {
  const meta = bet.entryMetadata as { numbers?: string[]; digits?: string; rawInput?: string; palti?: boolean };
  switch (bet.entryMethod) {
    case "JODI":
      return { numbers: [...(meta.numbers ?? [])] };
    case "CROSSING":
      return { digits: meta.digits };
    case "COPY_PASTE":
      return { rawInput: meta.rawInput, palti: meta.palti };
    default:
      return {};
  }
}

function buildReceipt(
  bet: BetDoc,
  market: MarketDoc,
  round: MarketRoundDoc,
  wallet: WalletView,
  now: Date,
): BetPlacementReceipt {
  const window = getBettingWindow(market.enabled, roundStateOf(round), now);
  return {
    bet: {
      id: bet._id.toString(),
      publicRef: bet.publicRef,
      market: { name: market.name, slug: market.slug, code: market.code },
      businessDate: round.businessDate,
      entryMethod: bet.entryMethod,
      entryMetadata: entryMetadataDTO(bet),
      selections: bet.selections.map((selection) => ({
        number: selection.number,
        stakePaise: selection.stakePaise,
      })),
      totalSelections: bet.totalSelections,
      totalStakePaise: bet.totalStakePaise,
      payoutMultiplierSnapshot: bet.payoutMultiplierSnapshot,
      status: bet.status,
      version: bet.version,
      placedAt: bet.placedAt.toISOString(),
      editCutoffAt: round.editCutoffAt.toISOString(),
      closesAt: round.closesAt.toISOString(),
      canEditNow: window.canEditBet,
    },
    wallet: {
      currency: wallet.currency,
      availableBalancePaise: wallet.availableBalancePaise,
      reservedBalancePaise: wallet.reservedBalancePaise,
    },
    serverNow: now.toISOString(),
  };
}

async function replayReceipt(
  bet: BetDoc,
  market: MarketDoc,
  normalized: NormalizedBetEntry,
  userId: Types.ObjectId,
  now: Date,
): Promise<BetPlacementReceipt> {
  if (!betMatchesRequest(bet, market._id, normalized)) {
    throw new DomainError("DUPLICATE_REQUEST", "This request id was already used for a different bet.");
  }
  const round = await MarketRound.findById(bet.marketRoundId);
  if (!round) throw new DomainError("INTERNAL_ERROR", "Placed bet round could not be loaded.");
  return buildReceipt(bet, market, round, await getWalletView(userId), now);
}

/**
 * Confirm a real bet.
 *
 *  1. read platform settings; normalize the entry through the shared engines (fail fast on bad
 *     input, no database round-trip)
 *  2. resolve the market; **existing-success idempotency recovery first** — a retry of an
 *     already-placed wager returns the original bet WITHOUT re-checking the close time (so a
 *     replay at 17:50:01 of a bet placed at 17:49:59 is not rejected) and WITHOUT a second
 *     debit; a retry with a different logical wager is `DUPLICATE_REQUEST`
 *  3. resolve the current operational round and gate on `getBettingWindow(...).canPlaceBet`
 *  4. ensure a ₹0 wallet exists (never grants funds), pre-allocate the bet `_id`
 *  5. one transaction: re-read market/round with a FRESH clock and re-check the window at the
 *     transactional boundary → snapshot the live payout multiplier → debit available balance
 *     (`BET_PLACED`, key `BET_PLACED:<betId>`) → insert the `Bet` (bounded `publicRef`-collision
 *     retry). Debit precedes the insert so a bet-write failure demonstrably rolls the wallet
 *     back. Any partial failure aborts the whole transaction.
 *  6. a lost `(userId, clientRequestId)` race (two simultaneous identical requests) collides on
 *     the unique index inside the aborted transaction; recover the winner outside it.
 */
export async function placeBet(input: PlaceBetInput, options: PlaceBetOptions = {}): Promise<BetPlacementReceipt> {
  const clock = options.clock ?? (() => new Date());
  const makeRef = options.generatePublicRef ?? generatePublicRef;
  const { userId, request } = input;

  const settings = await getPlatformSettings();
  const normalized = normalizeBetEntry(
    toPlaceEntryInput(request),
    request.stakePaise,
    settings.minimumStakePaise,
  );
  const market = await getMarketBySlug(request.marketSlug);

  const existing = await Bet.findOne({ userId, clientRequestId: request.clientRequestId });
  if (existing) {
    return replayReceipt(existing, market, normalized, userId, clock());
  }

  const resolved = await resolveCurrentRound(market, clock());
  if (!resolved.round || !resolved.bettingWindow.canPlaceBet) {
    throw blocked(resolved.bettingWindow.reason ?? "MARKET_CLOSED");
  }
  const roundId = resolved.round._id;

  // A fund-less player has no wallet yet; make one at ₹0 so the debit fails INSUFFICIENT_BALANCE
  // (a real domain answer) rather than WALLET_NOT_FOUND.
  await createPlayerWallet(userId);

  const betId = new Types.ObjectId();
  try {
    const { at } = await withTransaction(async (session) => {
      const now = clock();
      const freshMarket = await Market.findById(market._id).session(session);
      const freshRound = await MarketRound.findById(roundId).session(session);
      if (!freshMarket || !freshRound) {
        throw new DomainError("ROUND_NOT_FOUND", "This market has no round open for betting.");
      }
      const window = getBettingWindow(freshMarket.enabled, roundStateOf(freshRound), now);
      if (!window.canPlaceBet) throw blocked(window.reason ?? "MARKET_CLOSED");

      const liveSettings = await getPlatformSettings(session);
      const payoutMultiplierSnapshot = liveSettings.payoutMultiplier;

      // Debit precedes the bet insert so a bet-write failure demonstrably rolls the wallet back.
      await debitAvailableInSession(
        {
          userId,
          type: "BET_PLACED",
          amountPaise: normalized.totalStakePaise,
          idempotencyKey: `BET_PLACED:${betId.toHexString()}`,
          referenceType: "BET",
          referenceId: betId,
        },
        session,
      );

      // Pick a free public reference (bounded retry against the unique index), then insert the
      // bet with the native driver. A Mongoose document created in the session would be reset
      // by `connection.transaction()` on any retry, and resetting its `strict:"throw"`
      // `entryMetadata` sub-document throws — the plain insert avoids that entirely while the
      // unique `bets.publicRef` / `(userId, clientRequestId)` indexes stay the real backstop.
      let publicRef: string | undefined;
      for (let attempt = 1; attempt <= PUBLIC_REF_MAX_ATTEMPTS; attempt += 1) {
        const candidate = makeRef(freshMarket.code, freshRound.businessDate);
        const taken = await Bet.exists({ publicRef: candidate }).session(session);
        if (!taken) {
          publicRef = candidate;
          break;
        }
      }
      if (!publicRef) {
        throw new DomainError("INTERNAL_ERROR", "Could not allocate a unique bet reference.");
      }

      const betDoc = new Bet({
        _id: betId,
        publicRef,
        clientRequestId: request.clientRequestId,
        userId,
        marketId: freshMarket._id,
        marketRoundId: freshRound._id,
        entryMethod: normalized.entryMethod,
        entryMetadata: normalized.entryMetadata,
        selections: normalized.selections,
        totalSelections: normalized.selectionCount,
        totalStakePaise: normalized.totalStakePaise,
        payoutMultiplierSnapshot,
        status: "ACTIVE",
        version: 1,
        placedAt: now,
      });
      await betDoc.validate();
      await Bet.collection.insertOne(
        { ...betDoc.toObject(), createdAt: now, updatedAt: now },
        { session },
      );

      return { at: now };
    });

    const [bet, round] = await Promise.all([Bet.findById(betId), MarketRound.findById(roundId)]);
    if (!bet || !round) throw new DomainError("INTERNAL_ERROR", "Placed bet could not be loaded.");
    return buildReceipt(bet, market, round, await getWalletView(userId), at);
  } catch (error) {
    // Two simultaneous identical requests: the loser's Bet insert hit the unique
    // (userId, clientRequestId) index and its transaction (debit included) rolled back.
    if (isDuplicateKeyError(error)) {
      const raced = await Bet.findOne({ userId, clientRequestId: request.clientRequestId });
      if (raced) return replayReceipt(raced, market, normalized, userId, clock());
    }
    throw error;
  }
}
