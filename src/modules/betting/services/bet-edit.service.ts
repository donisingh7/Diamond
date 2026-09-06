import "server-only";
import { Types } from "mongoose";
import { DomainError, type ErrorCode } from "@/lib/errors/domain-error";
import { withTransaction } from "@/lib/db/connection";
import { getBettingWindow, type MarketAvailabilityReason } from "@/lib/dates/market-time";
import { Market } from "@/modules/markets/models/market.model";
import { MarketRound } from "@/modules/markets/models/market-round.model";
import { roundStateOf } from "@/modules/markets/services/market.service";
import { getPlatformSettings } from "@/modules/settings/services/platform-settings.service";
import { safeAdd } from "@/lib/money";
import {
  creditAvailableInSession,
  debitAvailableInSession,
  isDuplicateKeyError,
} from "@/modules/wallet/services/wallet.service";
import { normalizeBetEntry } from "../engines/normalize";
import type { NormalizedBetEntry } from "../engines/types";
import { Bet } from "../models/bet.model";
import { BetRevision } from "../models/bet-revision.model";
import { toEditEntryInput, type EditBetRequest } from "../validators/edit-bet-input";
import { getPlayerBetDetail, resolveOwnedBet, type PlayerBetDetailDTO } from "./bet-read.service";

/**
 * Bet editing — a WHOLE-wager replacement of an ACTIVE bet before its round's edit cutoff, with
 * an immutable `betRevisions` row and a wallet movement for the STAKE DIFFERENCE only. It is the
 * same-identity twin of placement: same `_id`, same `publicRef`, same `userId`, same
 * `marketRoundId`, same `placedAt`, same `payoutMultiplierSnapshot` — only `version` advances
 * (DOMAIN_RULES.md "BET EDITING" / "BET REVISIONS", Window 4A4 §3–§6).
 *
 * Reuses the SAME `normalizeBetEntry` engine as quote / placement (never a second parser), the
 * SAME `getBettingWindow` gate (checked against a FRESH clock at the transactional boundary, not
 * only before it — Window 4A4 §10), and the SAME wallet transaction primitives
 * (`BET_EDIT_DEBIT` / `BET_EDIT_REFUND`).
 *
 * Concurrency: optimistic on `version`. The request carries `expectedVersion`; the in-session
 * re-read plus a compare-and-set `updateOne({ version: expectedVersion, status: "ACTIVE" })`
 * plus the unique `betRevisions (betId, toVersion)` index mean two edits racing from the same
 * version cannot both win — the loser gets `STALE_VERSION`, never a silent overwrite.
 *
 * Idempotency: `editRequestId` (client UUID). A retry of the same logical edit returns the
 * ALREADY-APPLIED result — no second wallet movement, no second version bump — and does so
 * BEFORE the cutoff re-check, so a replay after cutoff still succeeds. The same id reused for a
 * different target wager is `DUPLICATE_REQUEST`. Backed by the unique `(userId, editRequestId)`
 * index.
 */

export type EditBetInput = {
  userId: Types.ObjectId;
  /** The bet's `id` handle (24-hex ObjectId) or its human `publicRef`. */
  betRef: string;
  request: EditBetRequest;
};

/** Test seams — production passes neither. */
export type EditBetOptions = {
  /** Authoritative time source. Called again inside the transaction (cutoff race — §10). */
  clock?: () => Date;
  /** Invoked inside the transaction right after the wallet movement, to force a rollback. */
  afterWalletMovement?: () => void;
};

const EDIT_BLOCK: Record<MarketAvailabilityReason, { code: ErrorCode; message: string }> = {
  MARKET_DISABLED: { code: "MARKET_DISABLED", message: "This market is disabled." },
  ROUND_NOT_FOUND: { code: "ROUND_NOT_FOUND", message: "This bet's round could not be found." },
  MARKET_NOT_OPEN: { code: "MARKET_NOT_OPEN", message: "This market is not open." },
  MARKET_CLOSED: { code: "MARKET_CLOSED", message: "This market is closed; the bet can no longer be edited." },
  EDIT_WINDOW_CLOSED: { code: "EDIT_WINDOW_CLOSED", message: "The edit window for this bet has closed." },
};

function editBlocked(reason: MarketAvailabilityReason): DomainError {
  const { code, message } = EDIT_BLOCK[reason];
  return new DomainError(code, message);
}

/** Deterministic per-edit wallet idempotency key (documented scheme `BET_EDIT:<betId>:<version>`). */
export function betEditWalletKey(betId: Types.ObjectId, toVersion: number, kind: "DEBIT" | "REFUND"): string {
  return `BET_EDIT_${kind}:${betId.toHexString()}:v${toVersion}`;
}

type CompositionSnapshot = {
  entryMethod: string;
  selections: readonly { number: string; stakePaise: number }[];
  totalStakePaise: number;
};

/** Canonical-wager equality for the idempotent-replay check: method + ordered selections + total. */
export function compositionMatchesNormalized(snapshot: CompositionSnapshot, normalized: NormalizedBetEntry): boolean {
  if (snapshot.entryMethod !== normalized.entryMethod) return false;
  if (snapshot.totalStakePaise !== normalized.totalStakePaise) return false;
  if (snapshot.selections.length !== normalized.selections.length) return false;
  return snapshot.selections.every(
    (selection, index) =>
      selection.number === normalized.selections[index].number
      && selection.stakePaise === normalized.selections[index].stakePaise,
  );
}

/**
 * Edit an ACTIVE bet.
 *
 *  1. read settings (`minimumStakePaise` only — the payout multiplier is NEVER refreshed on an
 *     edit, §4); normalize the replacement wager through the shared engine (fail fast, no db
 *     round-trip)
 *  2. resolve the caller's own bet (`BET_NOT_FOUND` if missing / not owned)
 *  3. **idempotent-replay recovery FIRST** — an existing revision for this `editRequestId` whose
 *     `after` snapshot equals the new wager returns the current bet detail WITHOUT re-checking
 *     the cutoff and WITHOUT a wallet movement (§9, §10); a different target wager (or a
 *     different bet) is `DUPLICATE_REQUEST`
 *  4. guard `status === "ACTIVE"` (`BET_ALREADY_SETTLED`) and `version === expectedVersion`
 *     (`STALE_VERSION`); gate on `getBettingWindow(...).canEditBet` for the bet's OWN round
 *  5. one transaction: re-read the bet + market + round in the session, re-check version /
 *     status / edit-window against a FRESH clock → move ONLY the stake difference
 *     (`BET_EDIT_DEBIT` if larger, `BET_EDIT_REFUND` if smaller, nothing if equal) → CAS
 *     `updateOne({ version: expectedVersion, status: "ACTIVE" })` (matchedCount 0 ⇒
 *     `STALE_VERSION`) → insert the immutable `betRevisions` row
 *  6. a concurrent duplicate collides on a unique `betRevisions` index; recover the winner
 *     outside the aborted transaction (replay, `DUPLICATE_REQUEST`, or `STALE_VERSION`)
 */
export async function editBet(input: EditBetInput, options: EditBetOptions = {}): Promise<PlayerBetDetailDTO> {
  const clock = options.clock ?? (() => new Date());
  const { userId, betRef, request } = input;

  const settings = await getPlatformSettings();
  const normalized = normalizeBetEntry(toEditEntryInput(request), request.stakePaise, settings.minimumStakePaise);

  const bet = await resolveOwnedBet(userId, betRef);
  const betId = bet._id;

  // --- idempotent-replay recovery, BEFORE any cutoff / version gate --------------------------
  const priorRevision = await BetRevision.findOne({ userId, editRequestId: request.editRequestId });
  if (priorRevision) {
    if (!priorRevision.betId.equals(betId) || !compositionMatchesNormalized(priorRevision.after, normalized)) {
      throw new DomainError("DUPLICATE_REQUEST", "This edit request id was already used for a different edit.");
    }
    return getPlayerBetDetail(userId, betId.toString(), clock());
  }

  if (bet.status !== "ACTIVE") {
    throw new DomainError("BET_ALREADY_SETTLED", "This bet is settled and can no longer be edited.");
  }
  if (bet.version !== request.expectedVersion) {
    throw new DomainError("STALE_VERSION", "This bet was modified since you loaded it. Reload and try again.");
  }

  const market = await Market.findById(bet.marketId);
  const round = await MarketRound.findById(bet.marketRoundId);
  if (!market || !round) {
    throw new DomainError("ROUND_NOT_FOUND", "This bet's round could not be found.");
  }
  const preWindow = getBettingWindow(market.enabled, roundStateOf(round), clock());
  if (!preWindow.canEditBet) throw editBlocked(preWindow.reason ?? "EDIT_WINDOW_CLOSED");

  const toVersion = bet.version + 1;
  const betObj = bet.toObject();
  const before: CompositionSnapshot & { entryMetadata: unknown } = {
    entryMethod: betObj.entryMethod,
    entryMetadata: betObj.entryMetadata,
    selections: betObj.selections.map((s: { number: string; stakePaise: number }) => ({
      number: s.number,
      stakePaise: s.stakePaise,
    })),
    totalStakePaise: betObj.totalStakePaise,
  };
  const after = {
    entryMethod: normalized.entryMethod,
    entryMetadata: normalized.entryMetadata,
    selections: normalized.selections.map((s) => ({ number: s.number, stakePaise: s.stakePaise })),
    totalStakePaise: normalized.totalStakePaise,
  };

  // new − old: positive ⇒ debit the difference, negative ⇒ refund the difference, zero ⇒ no movement (§6).
  const stakeDeltaPaise = safeAdd(after.totalStakePaise, -before.totalStakePaise);
  // betRevisions.walletDeltaPaise convention is `before.total − after.total` (schema-enforced).
  const walletDeltaPaise = safeAdd(before.totalStakePaise, -after.totalStakePaise);

  // Validate the post-edit composition through the schema invariants BEFORE the native writes
  // (native updateOne / insertOne bypass `pre("validate")`), mirroring the placement service.
  const editedBetDoc = new Bet({
    ...betObj,
    entryMethod: after.entryMethod,
    entryMetadata: after.entryMetadata,
    selections: after.selections,
    totalSelections: normalized.selectionCount,
    totalStakePaise: after.totalStakePaise,
    version: toVersion,
    lastEditedAt: clock(),
  });
  await editedBetDoc.validate();

  const revisionDoc = new BetRevision({
    betId,
    userId,
    fromVersion: bet.version,
    toVersion,
    before: { entryMethod: before.entryMethod, entryMetadata: before.entryMetadata, selections: before.selections, totalStakePaise: before.totalStakePaise },
    after,
    walletDeltaPaise,
    editRequestId: request.editRequestId,
    editedAt: clock(),
  });
  await revisionDoc.validate();

  try {
    const { at } = await withTransaction(async (session) => {
      const now = clock();

      const fresh = await Bet.findOne({ _id: betId, userId }).session(session);
      if (!fresh) throw new DomainError("BET_NOT_FOUND", "Bet not found.");
      if (fresh.status !== "ACTIVE") {
        throw new DomainError("BET_ALREADY_SETTLED", "This bet is settled and can no longer be edited.");
      }
      if (fresh.version !== request.expectedVersion) {
        throw new DomainError("STALE_VERSION", "This bet was modified by another edit. Reload and try again.");
      }

      const freshMarket = await Market.findById(bet.marketId).session(session);
      const freshRound = await MarketRound.findById(bet.marketRoundId).session(session);
      if (!freshMarket || !freshRound) {
        throw new DomainError("ROUND_NOT_FOUND", "This bet's round could not be found.");
      }
      const window = getBettingWindow(freshMarket.enabled, roundStateOf(freshRound), now);
      if (!window.canEditBet) throw editBlocked(window.reason ?? "EDIT_WINDOW_CLOSED");

      // Move ONLY the difference — never refund and re-debit the whole bet (§6).
      if (stakeDeltaPaise > 0) {
        await debitAvailableInSession(
          {
            userId,
            type: "BET_EDIT_DEBIT",
            amountPaise: stakeDeltaPaise,
            idempotencyKey: betEditWalletKey(betId, toVersion, "DEBIT"),
            referenceType: "BET",
            referenceId: betId,
          },
          session,
        );
      } else if (stakeDeltaPaise < 0) {
        await creditAvailableInSession(
          {
            userId,
            type: "BET_EDIT_REFUND",
            amountPaise: -stakeDeltaPaise,
            idempotencyKey: betEditWalletKey(betId, toVersion, "REFUND"),
            referenceType: "BET",
            referenceId: betId,
          },
          session,
        );
      }

      options.afterWalletMovement?.();

      // Compare-and-set: the (version, status) filter is the atomic optimistic lock. A concurrent
      // edit that already advanced the version makes this match zero documents.
      const result = await Bet.collection.updateOne(
        { _id: betId, userId, version: request.expectedVersion, status: "ACTIVE" },
        {
          $set: {
            entryMethod: after.entryMethod,
            entryMetadata: after.entryMetadata,
            selections: after.selections,
            totalSelections: normalized.selectionCount,
            totalStakePaise: after.totalStakePaise,
            version: toVersion,
            lastEditedAt: now,
            updatedAt: now,
          },
        },
        { session },
      );
      if (result.matchedCount !== 1) {
        throw new DomainError("STALE_VERSION", "This bet was modified by another edit. Reload and try again.");
      }

      // Immutable revision — the unique (betId, toVersion) and (userId, editRequestId) indexes
      // are the real backstop against a double edit / a replayed request id.
      const revObj = revisionDoc.toObject();
      revObj.editedAt = now;
      revObj._id = new Types.ObjectId();
      await BetRevision.collection.insertOne(revObj, { session });

      return { at: now };
    });

    return getPlayerBetDetail(userId, betId.toString(), at);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      // Concurrent duplicate: same editRequestId ⇒ replay the winner; a (betId, toVersion)
      // collision from a different racing edit ⇒ that edit won, so this one is stale.
      const raced = await BetRevision.findOne({ userId, editRequestId: request.editRequestId });
      if (raced && raced.betId.equals(betId) && compositionMatchesNormalized(raced.after, normalized)) {
        return getPlayerBetDetail(userId, betId.toString(), clock());
      }
      if (raced) {
        throw new DomainError("DUPLICATE_REQUEST", "This edit request id was already used for a different edit.");
      }
      throw new DomainError("STALE_VERSION", "This bet was modified by another edit. Reload and try again.");
    }
    throw error;
  }
}
