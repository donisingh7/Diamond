# Intended API contracts

Read [CODEX_RULES.md](CODEX_RULES.md) first. These requirements are authoritative and originate from the approved Window 1 brief. DOMAIN_RULES.md owns business rules; the roadmap limits implementation scope. Future-facing descriptions do not imply implemented features.

## API CONTRACT DOCUMENTATION

In `API_CONTRACTS.md`, document future intended boundaries including approximately:

## Auth

```text
POST /api/auth/login
POST /api/auth/otp/request
POST /api/auth/otp/verify
POST /api/auth/logout
GET  /api/auth/me
```

## Player

```text
GET  /api/markets
GET  /api/markets/:slug

GET  /api/results

POST /api/bets/quote
POST /api/bets
GET  /api/bets
GET  /api/bets/:id
PATCH /api/bets/:id

GET  /api/wallet
GET  /api/wallet/transactions
POST /api/wallet/mock-deposit

POST /api/withdrawals
GET  /api/withdrawals
POST /api/withdrawals/:id/cancel
```

## Admin

```text
GET    /api/admin/players
POST   /api/admin/players
GET    /api/admin/players/:id
PATCH  /api/admin/players/:id/status
POST   /api/admin/players/:id/reset-password
DELETE /api/admin/players/:id

POST   /api/admin/players/:id/wallet-adjustment

GET    /api/admin/markets
PATCH  /api/admin/markets/:id

GET    /api/admin/results
POST   /api/admin/rounds/:id/declare-result

GET    /api/admin/bets

GET    /api/admin/withdrawals
POST   /api/admin/withdrawals/:id/approve
POST   /api/admin/withdrawals/:id/reject

GET    /api/admin/audit

GET    /api/admin/settings
PATCH  /api/admin/settings/game-rate
```

These are architectural contracts, not a requirement to fully implement every endpoint in Window 1.

## Proposed DTO conventions (not implemented endpoints)

All routes above are future contracts. No route handlers or server actions are exposed in Window 1. Use JSON success `{data: ...}` and failure `{error: {code, message}}`. Serialize UTC instants as ISO strings, businessDate as `YYYY-MM-DD`, monetary response fields as integer `...Paise`, and selection/result numbers as exactly two-character strings. Request bodies are strict Zod schemas. Return 400 for malformed input, 401 unauthenticated, 403 forbidden/disabled, 404 missing or non-owned records, 409 state/version/idempotency conflict, 422 valid-shaped but invalid-domain input, and generic 500 for unexpected errors.

List routes use opaque cursor/limit pagination, stable timestamp plus _id ordering, and server filters. Select limits in the implementing window; do not create unbounded histories. Player bet `:id` routes should resolve publicRef (not a primary user-facing ObjectId). Public reference knowledge never grants access. Admin player/round IDs may remain internal identifiers; ticket references remain human-readable.

| Operation family | Intended input | Server response/obligations |
| --- | --- | --- |
| login | loginId, password | Set session cookie; safe user summary; never return hashes. Role determines shell access. |
| otp/request | loginId | Generic acknowledgement/request identifier; never return code in a normal public response. |
| otp/verify | requestId, code | Consume once, verify attempts/expiry/user, set session cookie. |
| logout / me | Cookie only | Invalidate session / return allowlisted current user. |
| markets / results | Slug, optional business-date/result filters | Persisted times, derived server status, serverNow, declared results and settlement state. |
| bets/quote | marketRoundId, entryInput, stakeRupees decimal text | Server-normalized selections, totals, current rate, eligibility; no money movement and no final reference. |
| POST bets | Same source inputs plus clientRequestId | Recompute against current server state; atomic bet+wallet+ledger; return publicRef/version/payout snapshot/timestamps. Quote is advisory. |
| PATCH bets/:id | Entire replacement input, stakeRupees, expectedVersion, editRequestId | Recompute, enforce cutoff and ACTIVE, atomically edit + revision + wallet delta; retain publicRef and original payout snapshot. |
| GET bets / details | Own filters or publicRef | Canonical composition, payout snapshot, status, revisions where requested; only owner access. |
| wallet / transactions | Own pagination/filter inputs | Available/reserved separately and ledger history; no mutation via GET. |
| mock-deposit | amountRupees decimal text, clientRequestId | Validate enabled mock mode/minimum, atomic available credit + ledger, idempotent receipt. |
| withdrawal request | amountRupees, BANK/UPI, typed paymentDetails, clientRequestId | Atomic available-to-reserved transfer + PENDING withdrawal + ledger. |
| withdrawal cancel | Own withdrawal ID | Conditional PENDING transition, release reserved atomically; retries return existing outcome without moving money. |
| admin players create / status / password | Explicit identity fields / ACTIVE or DISABLED / replacement password | Authorized service; zero-wallet creation, session invalidation, redacted audit as applicable. No hidden starting balance. |
| admin delete player | Player ID and explicit confirmation UX | Central purge service; no retained deleted identifier. |
| admin wallet adjustment | CREDIT/DEBIT, amountRupees, reason, clientRequestId | Wallet service guard against negative funds + ledger + audit in transaction. |
| admin markets patch | Enabled or validated schedule fields | Persist configuration with audit; do not mutate existing round snapshots silently. |
| admin declare result | Closed round ID, two-digit result, clientRequestId | Review in UI; transactional declaration metadata + audit, idempotent scheduling of settlement. |
| admin withdrawals approve/reject | Withdrawal ID; rejection requires reason | Conditional PENDING decision + reserved finalization/release + ledger + audit. No bank transfer. |
| admin game-rate | Positive integer payoutMultiplier | Audited singleton update; existing bets keep original snapshot. |
| admin read lists / settings / audit | Authorized filters and pagination | Redacted DTOs only; no mutation of historical rows from read views. |

`entryInput` is `{entryMethod:'JODI', numbers:string[]}`, `{entryMethod:'CROSSING', digits:string}`, or `{entryMethod:'COPY_PASTE', rawInput:string, palti:boolean}`. Common stakeRupees applies to every normalized selection. Browser totals/counts/balance/status/payout/edit eligibility are not accepted as authority. Idempotency scope includes authenticated user and operation; compare a canonical request fingerprint or the stored request to reject key reuse with a different payload. Future financial transaction keys can be `BET_PLACE:<betId>`, `BET_EDIT:<betId>:<version>`, `WIN:<betId>`, and withdrawal ID plus transition.

## Window 2B — implemented Auth contract

The five auth routes above are now real route handlers (`src/app/api/auth/**/route.ts`), all cookie-authenticated, all returning `{data:...}` or `{error:{code,message}}` per the conventions above. One deliberate, documented refinement versus the original sketch: **login takes an explicit `portal`** (`"PLAYER" | "ADMIN"`) rather than inferring shell access purely from the account's stored role — Window 2B's brief required a credential for one portal to fail outright against the other, not silently authenticate into the wrong shell. See SECURITY_AND_AUTH.md's "Window 2B implementation" section for the full session/OTP/CSRF design; this section only records request/response shapes.

| Route | Request body | 200/201 `data` | Notable error codes |
| --- | --- | --- | --- |
| `POST /api/auth/login` | `{portal: "PLAYER"\|"ADMIN", loginId, password}` | `{user: PublicUser}` + sets session cookie | `INVALID_CREDENTIALS` (401, also covers missing user and wrong portal), `USER_DISABLED` (403) |
| `POST /api/auth/otp/request` | `{phone}` | `{requestId, message}` (`message` is always the same generic acknowledgement); `devCode` also present only when `NODE_ENV==="development"` | — (always 200; ineligible phones get a decoy `requestId` instead of an error) |
| `POST /api/auth/otp/verify` | `{requestId, code}` | `{user: PublicUser}` + sets session cookie | `INVALID_OTP` (422 — covers unknown/expired/consumed/attempts-exceeded/wrong code identically) |
| `POST /api/auth/logout` | none (cookie only) | `{loggedOut: true}` + clears session cookie | none; idempotent even with no/invalid cookie |
| `GET /api/auth/me` | none (cookie only) | `{user: PublicUser}` | `UNAUTHENTICATED` (401 — also covers a disabled/deleted user's stale cookie) |

`PublicUser` is `{id, role, loginId, name, phone, email, status}` (`src/modules/users/services/public-user.ts`) — the only shape ever sent to a browser; a hydrated Mongoose document (with `passwordHash`, even when explicitly `.select("+passwordHash")`ed for verification) is never spread into a response. All four state-changing routes reject a request whose `Origin` header doesn't match the request's own origin (`src/lib/http/same-origin.ts`); `GET /me` is read-only and exempt. Zod validation failures on any route return `400 INVALID_INPUT` before reaching the domain service.

## Window 3A — implemented Player market & results contract

Three read-only routes (`src/app/api/markets/route.ts`, `src/app/api/markets/[slug]/route.ts`, `src/app/api/results/route.ts`), all `apiRoute`-wrapped with the shared `{data:...}` / `{error:{code,message}}` shape, all requiring an **ACTIVE PLAYER** session via the reused `requirePlayer()` primitive (no per-route cookie parsing). An unauthenticated request is `401 UNAUTHENTICATED`; an authenticated **ADMIN** is `403 FORBIDDEN` — these are PLAYER-only APIs and the role boundary is preserved, not widened. Being GETs they are exempt from the same-origin check, matching `GET /api/auth/me`. Each response includes `serverNow` (ISO-8601) so a later frontend can correct client clock skew in countdowns. No player market/results UI was built against them in this window.

| Route | Query | `200` `data` | Notable errors |
| --- | --- | --- | --- |
| `GET /api/markets` | none | `{markets: MarketDTO[], serverNow}` | `401`, `403` |
| `GET /api/markets/[slug]` | none | `{market: MarketDTO, serverNow}` | `401`, `403`, `MARKET_NOT_FOUND` (404) |
| `GET /api/results` | `range=today\|7d\|30d` (default `today`), optional `market=<slug>` | `{range, results: ResultEntry[], serverNow}` | `401`, `403`, `INVALID_INPUT` (400 — bad range or stray param; `.strict()` Zod), `MARKET_NOT_FOUND` (404 — unknown `market`) |

`MarketDTO` = `{id, name, slug, code, timezone, enabled, editLockMinutesBeforeClose, displayOrder, state, round}`. `state` is the `deriveMarketStatus` value (`DISABLED|UPCOMING|OPEN|CLOSING_SOON|RESULT_PENDING|RESULT_DECLARED|SETTLED`). `round` is `null` for a disabled market, otherwise `{id, businessDate:"YYYY-MM-DD", opensAt, editCutoffAt, closesAt, state, result:"NN"|null, resultDeclaredAt: iso|null, settlementStatus, canPlaceBet, canEditBet, unavailableReason}`. `canPlaceBet`/`canEditBet`/`unavailableReason` are `getBettingWindow` output verbatim; Window 4 reuses that helper directly rather than parsing the DTO.

`ResultEntry` = `{marketId, name, slug, code, displayOrder, businessDate, state, result:"NN"|null, resultDeclaredAt: iso|null, settlementStatus, opensAt: iso|null, closesAt: iso|null}`. No `declaredByAdminId` or other admin identifiers are exposed.

`range=today` returns one entry per market — its current operational round (see ARCHITECTURE.md's resolution table: a cross-midnight market between 00:00 and 03:00 IST still reports the previous business date; 03:00–07:00 reports the upcoming round with `result: null`). `range=7d`/`30d` return only persisted **result-bearing** rounds inside an inclusive `Asia/Kolkata` calendar window ending on the current business day (7d = today + 6 prior days; 30d = today + 29), capped at today; ordered newest business date first, then `displayOrder`. Neither range ever creates rounds. `INVALID_RESULT_RANGE` (400) is a defined code for a range value that somehow reaches the service unrecognised; the Zod enum normally rejects it first as `INVALID_INPUT`.

## Window 4A1 — implemented bet quote contract

`POST /api/bets/quote` is now a real route handler (`src/app/api/bets/quote/route.ts`), `apiRoute`-wrapped with the shared `{data:...}` / `{error:{code,message}}` shape, requiring an **ACTIVE PLAYER** session via `requirePlayer()` (an anonymous request is `401 UNAUTHENTICATED`; an authenticated **ADMIN** is `403 FORBIDDEN` — PLAYER-only, not widened). As a state-changing `POST` it is subject to the same-origin check (`403` on a mismatched `Origin`), matching the auth mutation routes. `export const dynamic = "force-dynamic"`.

The quote is **informational and non-binding**: it performs **no wallet balance check**, reserves nothing, and writes **no bet / wallet / ledger document**. It may create the day's operational `MarketRound` (existing Window 3A behaviour). Actual placement (`POST /api/bets`, a later window) recomputes everything server-side and must not trust a stale quote.

Two deliberate, documented refinements of the "Proposed DTO conventions" sketch above (which predates the engines):

- The request carries **`stakePaise`** (integer paise) rather than `stakeRupees` decimal text — Window 4A1's brief specifies integer paise end to end, and the engine contract already takes `stakePaise: number`. The domain minimum (`platformSettings.minimumStakePaise`) is enforced by the engine, so a below-minimum stake is `STAKE_BELOW_MINIMUM` (422), not a generic 400.
- The request identifies the market by **`marketSlug`** (not `marketRoundId`) — consistent with Window 3A's slug-addressed market routes and CODEX_RULES' "never expose a Mongo ObjectId to the client" rule. The response **returns** `marketRoundId` for a later placement call to reference.

| Route | Request body (discriminated on `entryMethod`, each branch `.strict()`) | `200` `data` | Notable errors |
| --- | --- | --- | --- |
| `POST /api/bets/quote` | `{marketSlug, entryMethod:"JODI", numbers: string[]  (1–100, each `/^\d{2}$/`), stakePaise: int>0}` · `{marketSlug, entryMethod:"CROSSING", digits: /^\d+$/ (≤100), stakePaise}` · `{marketSlug, entryMethod:"COPY_PASTE", rawInput: string (1–2000), palti: boolean, stakePaise}` | `BetQuote` | `401`, `403`, `INVALID_INPUT` (400 — malformed shape or an irrelevant cross-method field), `INVALID_SELECTION` (422 — malformed numbers/digits/paste/palti input), `STAKE_BELOW_MINIMUM` (422), `MONEY_OUT_OF_RANGE` (422 — arithmetic beyond safe-integer precision), `MARKET_NOT_FOUND` (404), `MARKET_DISABLED` / `MARKET_NOT_OPEN` / `MARKET_CLOSED` (422) |

`BetQuote` = `{marketSlug, marketId, marketRoundId, businessDate:"YYYY-MM-DD", marketState, entryMethod, entryMetadata, engineMetadata, selections:[{number:"NN", stakePaise}], selectionCount, stakePerSelectionPaise, totalStakePaise, currency, payoutMultiplier, perWinningSelectionCreditPaise, editCutoffAt: iso, editableAfterPlacing: boolean, binding: false, serverNow: iso}`.

- `entryMetadata` mirrors the persisted `bets.entryMetadata` shape: `{numbers}` (JODI, the raw submitted list) · `{digits}` (CROSSING) · `{rawInput, palti}` (COPY_PASTE). It is source metadata for reconstruction — **not** authoritative over `selections`.
- `engineMetadata` is non-persisted UI convenience: `{uniqueDigits, uniqueDigitCount}` for CROSSING, `{parsedNumbers}` for COPY_PASTE, `{}` otherwise.
- `selections` is the canonical de-duplicated wager, deterministically ordered (Crossing: first-appearance Cartesian; Copy Paste / Palti: first-occurrence). The same common `stakePaise` is applied to every selection.
- `perWinningSelectionCreditPaise = stakePerSelectionPaise × payoutMultiplier` — the complete credit for a winning selection; the stake is not added back. `payoutMultiplier` is read live from `platformSettings`, so changing it there changes the quote with no code change.
- `editableAfterPlacing` is `false` during the `CLOSING_SOON` / edit-locked interval, where new bets are still allowed (so the quote still succeeds).
- `binding: false` is a literal constant marking the quote advisory.

No `clientRequestId` / idempotency key — that belongs to placement. Repeated identical quote requests return equivalent results for the same server state and settings.

## Window 4A2 — implemented player wallet contract

Three route handlers under `src/app/api/wallet/**`, all `apiRoute`-wrapped (`{data:...}` /
`{error:{code,message}}`), all requiring an **ACTIVE PLAYER** session via `requirePlayer()`
(anonymous → `401 UNAUTHENTICATED`; **ADMIN** → `403 FORBIDDEN` — PLAYER-only, not widened),
all `export const dynamic = "force-dynamic"`. Identity is always the authenticated session —
a client-supplied `userId` is never accepted for a wallet read or mutation. Every response
carries `serverNow` (ISO-8601). The two GETs are exempt from the same-origin check (matching
`GET /api/auth/me`); the `POST` requires a trusted `Origin` (`403` on mismatch).

| Route | Request | `200` `data` | Notable errors |
| --- | --- | --- | --- |
| `GET /api/wallet` | none | `{ wallet: WalletView, serverNow }` | `401`, `403` |
| `POST /api/wallet/mock-deposit` | `{ amountPaise: int > 0, clientRequestId: uuid }` (`.strict()`) | `{ transaction: { id, type:"MOCK_DEPOSIT", amountPaise }, wallet: WalletView, serverNow }` | `401`, `403` (also cross-origin, ADMIN, `mockDepositEnabled:false`), `INVALID_INPUT` (400 — bad shape / non-UUID id / stray key), `INVALID_AMOUNT` (422 — below ₹1), `MONEY_OUT_OF_RANGE` (422 — beyond safe integer), `DUPLICATE_REQUEST` (409 — `clientRequestId` reused with a different amount) |
| `GET /api/wallet/transactions` | `?limit=` 1–100 (default 20), `?cursor=` opaque (`.strict()`) | `{ transactions: WalletTransactionDTO[], nextCursor: string \| null, serverNow }` | `401`, `403`, `INVALID_INPUT` (400 — `limit` out of range, stray param, malformed cursor) |

`WalletView` = `{ currency: "INR", availableBalancePaise, reservedBalancePaise,
totalBalancePaise }`. `totalBalancePaise` is derived (`available + reserved`), not persisted.

`WalletTransactionDTO` = `{ id, type, amountPaise, availableDeltaPaise, reservedDeltaPaise,
availableBeforePaise, availableAfterPaise, reservedBeforePaise, reservedAfterPaise,
referenceType: string | null, createdAt: iso }`. Newest first. Internal admin/security
metadata — `idempotencyKey`, `createdByAdminId`, `walletId`, `userId` — is **never**
serialized. The list is always bounded; there is no all-history response. `nextCursor` is an
opaque base64url token over the last row's `(createdAt, _id)`; pass it back as `?cursor=` for
the next (older) page, `null` means the last page was returned.

Deliberate, documented refinements of the "Proposed DTO conventions" sketch (which predates
this window):

- `mock-deposit` takes **`amountPaise`** (integer paise) not `amountRupees` decimal text —
  Window 4A2 is integer-paise end to end. The ₹1 minimum and safe-integer ceiling are enforced
  by the service (`assertMockDepositAmount`), not just this route's Zod, so every future caller
  of the wallet core gets the same checks — a below-minimum deposit is `INVALID_AMOUNT` (422),
  not a generic 400.
- `mock-deposit`'s response includes `serverNow` in addition to the sketch's
  `{ transaction, wallet }` — additive, consistent with every other route in this codebase.
- No `POST /api/wallet/credit` or any generic credit route exists — Mock Deposit is the **only**
  public player credit path in the prototype. Admin credit/debit, withdrawals, settlement and
  bet debits use the internal `wallet.service` primitives from their own (unbuilt) windows.

### Reuse contract for later windows (not yet routed)

The wallet core exposes transaction-scoped primitives a caller invokes with its own
`ClientSession`:

```text
applyWalletMovement({ userId, type, amountPaise, idempotencyKey, referenceType?, referenceId?, actorAdminId? }, session)
debitAvailableInSession(...)     // BET_PLACED | BET_EDIT_DEBIT | ADMIN_DEBIT
creditAvailableInSession(...)    // MOCK_DEPOSIT | BET_EDIT_REFUND | WIN_CREDIT | ADMIN_CREDIT
reserveInSession(...) / releaseReservedInSession(...) / finalizeReservedInSession(...)
createPlayerWallet(userId, session?) / getWalletView(userId) / getTransactionByIdempotencyKey(key, session?)
```

Each returns `{ transactionId, type, amountPaise, availableBalancePaise, reservedBalancePaise,
idempotentReplay }`. Window 4A3's `POST /api/bets` will call `debitAvailableInSession` inside
the same transaction as `Bet.create`; edit uses the `BET_EDIT_*` types; settlement uses
`WIN_CREDIT`; withdrawal workflow uses reserve/release/finalize; admin adjustment uses
`ADMIN_CREDIT` / `ADMIN_DEBIT`. None of those higher-level workflows are implemented here.

## Window 4A3 — implemented bet placement contract

`POST /api/bets` is now a real route handler (`src/app/api/bets/route.ts`), `apiRoute`-wrapped
with the shared `{data:...}` / `{error:{code,message}}` shape, requiring an **ACTIVE PLAYER**
session via `requirePlayer()` (anonymous → `401 UNAUTHENTICATED`; **ADMIN** → `403 FORBIDDEN` —
PLAYER-only, not widened; a disabled/deleted user's stale cookie is rejected by
`findActiveSessionUser`). As a state-changing `POST` it requires a trusted `Origin` (`403` on
mismatch), matching the auth / quote / mock-deposit mutations. `export const dynamic =
"force-dynamic"`. The bet owner is the authenticated session — **no `userId` is accepted from
the client**.

The request is the Window 4A1 quote body plus **`clientRequestId`** (a client-generated UUID),
using the SAME field names as `quoteRequestSchema`. Each `entryMethod` branch is `.strict()`,
so the server refuses any client-supplied authoritative value — `totalStakePaise`,
`selectionCount`, `selections`, `payoutMultiplier`, `marketRoundId`, `payout`, `publicRef`,
wallet balance — all of which are server-derived. Placement **recomputes everything** through
the shared `normalizeBetEntry` engine and the Window 3A market services; a prior quote is
advisory and is not trusted (`binding: false`).

| Route | Request body (discriminated on `entryMethod`, each branch `.strict()`) | `200` `data` | Notable errors |
| --- | --- | --- | --- |
| `POST /api/bets` | `{marketSlug, entryMethod:"JODI", numbers: string[] (1–100, each /^\d{2}$/), stakePaise: int>0, clientRequestId: uuid}` · `{marketSlug, entryMethod:"CROSSING", digits: /^\d+$/ (≤100), stakePaise, clientRequestId}` · `{marketSlug, entryMethod:"COPY_PASTE", rawInput: string (1–2000), palti: boolean, stakePaise, clientRequestId}` | `BetPlacementReceipt` | `401`, `403`, `INVALID_INPUT` (400 — malformed shape, non-UUID id, missing/irrelevant field), `INVALID_SELECTION` / `STAKE_BELOW_MINIMUM` / `MONEY_OUT_OF_RANGE` (422), `MARKET_NOT_FOUND` (404), `MARKET_DISABLED` / `MARKET_NOT_OPEN` / `MARKET_CLOSED` (422), `ROUND_NOT_FOUND` (404), `INSUFFICIENT_BALANCE` (422), `DUPLICATE_REQUEST` (409 — `clientRequestId` reused for a different logical wager) |

`BetPlacementReceipt` =

```text
{ bet: { id, publicRef: "FB-0906-X7K29", market: { name, slug, code }, businessDate: "YYYY-MM-DD",
         entryMethod, entryMetadata, selections: [{ number: "NN", stakePaise }],
         totalSelections, totalStakePaise, payoutMultiplierSnapshot, status: "ACTIVE",
         version: 1, placedAt: iso, editCutoffAt: iso, closesAt: iso, canEditNow: boolean },
  wallet: { currency: "INR", availableBalancePaise, reservedBalancePaise },
  serverNow: iso }
```

- `bet.id` is the bet's own handle (consistent with the wallet DTOs' `id`); the user-facing
  ticket reference is `bet.publicRef`. **Never serialized:** `clientRequestId`, the ledger
  idempotency key, `marketId` / `marketRoundId` / `userId` / `walletId`, any admin field.
- `entryMetadata` mirrors the persisted `bets.entryMetadata` shape — `{numbers}` (JODI, the raw
  submitted list) · `{digits}` (CROSSING) · `{rawInput, palti}` (COPY_PASTE). Not authoritative
  over `selections`.
- `selections` is the canonical de-duplicated wager in deterministic engine order, the common
  `stakePaise` applied to every entry. `payoutMultiplierSnapshot` is `platformSettings.
  payoutMultiplier` read inside the placement transaction — a later rate change never rewrites it.
- `canEditNow` is `getBettingWindow(...).canEditBet` — `false` for a bet placed in the
  edit-locked `CLOSING_SOON` interval `[editCutoffAt, closesAt)`, where new placement is still
  allowed. The placement itself is valid; the bet is simply immediately non-editable.

**Idempotency.** A retry with the same `clientRequestId` and the *same* logical wager (same
market, entry method, canonical selections and stake — cosmetic raw-input differences that
normalize identically count as the same) returns the **original** bet — same `id`, same
`publicRef` — with no second wallet debit or ledger row, and does so **before** the market-close
re-check (a replay at 17:50:01 of a bet placed at 17:49:59 is not rejected `MARKET_CLOSED`; a
*new* `clientRequestId` after close is). The same id reused for a *different* logical wager is
`DUPLICATE_REQUEST` (409). Two simultaneous identical requests resolve to one bet / one debit /
one `BET_PLACED` ledger row.

**Atomicity.** `Bet` insert + `availableBalancePaise` debit + immutable `BET_PLACED`
`walletTransactions` row are one MongoDB transaction — any partial failure (insufficient
balance, a market-state change, a bet-write failure) leaves no `bets`, wallet or ledger change.
Reserved balance is never spendable for a bet.

Deliberate, documented refinements of the "Proposed DTO conventions" sketch (which predates
this window), consistent with Window 4A1/4A2:

- the request carries **`stakePaise`** (integer paise), not `stakeRupees` decimal text —
  integer paise end to end;
- the market is identified by **`marketSlug`**, not `marketRoundId` (never expose a Mongo
  ObjectId to the client); the receipt does not return `marketRoundId` at all;
- the success response is `200` with `{ data: BetPlacementReceipt }` (not `201`), matching every
  other mutation route in this codebase, and carries `serverNow`.

## Window 4A4 - implemented player bet read & edit contract

Three route handlers: `GET /api/bets` (added alongside the existing `POST` in
`src/app/api/bets/route.ts`), plus `GET` and `PATCH` in `src/app/api/bets/[id]/route.ts`. All
`apiRoute`-wrapped with the shared `{data:...}` / `{error:{code,message}}` shape, all requiring
an **ACTIVE PLAYER** session via `requirePlayer()` (anonymous -> `401 UNAUTHENTICATED`; **ADMIN**
-> `403 FORBIDDEN` - PLAYER-only, not widened; a disabled/deleted user's stale cookie is
rejected by `findActiveSessionUser`), all `export const dynamic = "force-dynamic"`. Identity is
always the authenticated session - **no `userId` is accepted from the client**. Every response
carries `serverNow` (ISO-8601). The two GETs are exempt from the same-origin check (matching
`GET /api/auth/me`); `PATCH` requires a trusted `Origin` (`403` on mismatch).

The roadmap sequences "My Bets" under Window 5; only its read **backend** ships here (no UI).
`PATCH /api/bets/:id` completes the Window 4 "Bet Editing + Bet Revisions" scope.

| Route | Request | `200` `data` | Notable errors |
| --- | --- | --- | --- |
| `GET /api/bets` | `?limit=` 1-50 (default 20), `?cursor=` opaque, `?status=ACTIVE\|WON\|LOST`, `?market=<slug>` (`.strict()`) | `{ bets: PlayerBetDTO[], nextCursor: string \| null, serverNow }` | `401`, `403`, `INVALID_INPUT` (400 - bad limit / stray param / malformed cursor), `MARKET_NOT_FOUND` (404 - unknown `market`) |
| `GET /api/bets/[id]` | `[id]` = the bet `id` handle (24-hex) **or** its `publicRef` (case-insensitive) | `{ bet: PlayerBetDetailDTO, serverNow }` | `401`, `403`, `BET_NOT_FOUND` (404 - missing **or** non-owned, indistinguishable) |
| `PATCH /api/bets/[id]` | `[id]` as above; body discriminated on `entryMethod`, each branch `.strict()`: `{ entryMethod:"JODI", numbers: string[] (1-100, each /^\d{2}$/), stakePaise: int>0, expectedVersion: int>=1, editRequestId: uuid }` / `{ entryMethod:"CROSSING", digits: /^\d+$/ (<=100), stakePaise, expectedVersion, editRequestId }` / `{ entryMethod:"COPY_PASTE", rawInput: string (1-2000), palti: boolean, stakePaise, expectedVersion, editRequestId }` | `{ bet: PlayerBetDetailDTO, serverNow }` | `401`, `403` (also cross-origin), `INVALID_INPUT` (400 - malformed shape, non-UUID id, `marketSlug` / `clientRequestId` / any authoritative field), `BET_NOT_FOUND` (404), `BET_ALREADY_SETTLED` (409), `STALE_VERSION` (409 - `expectedVersion` mismatch / lost concurrent edit), `DUPLICATE_REQUEST` (409 - `editRequestId` reused for a different target wager), `EDIT_WINDOW_CLOSED` / `MARKET_CLOSED` / `MARKET_DISABLED` / `MARKET_NOT_OPEN` (422/422/422/422), `ROUND_NOT_FOUND` (404), `INVALID_SELECTION` / `STAKE_BELOW_MINIMUM` / `MONEY_OUT_OF_RANGE` (422), `INSUFFICIENT_BALANCE` (422) |

`PlayerBetDTO` =

```text
{ id, publicRef: "FB-0906-X7K29", market: { name, slug, code }, businessDate: "YYYY-MM-DD",
  entryMethod, entryMetadata, selections: [{ number: "NN", stakePaise }], totalSelections,
  totalStakePaise, payoutMultiplierSnapshot, status: "ACTIVE"|"WON"|"LOST", version,
  placedAt: iso, lastEditedAt: iso | null, editCutoffAt: iso, closesAt: iso, canEditNow: boolean,
  result: "NN" | null, winningNumber: "NN" | null, payoutPaise: number | null, settledAt: iso | null }
```

`PlayerBetDetailDTO` = `PlayerBetDTO & { revisions: BetRevisionDTO[] }` (oldest first).
`BetRevisionDTO` = `{ fromVersion, toVersion, before, after, walletDeltaPaise, editedAt: iso }`
where `before` / `after` = `{ entryMethod, entryMetadata, selections: [{ number, stakePaise }],
totalStakePaise }`.

- `id` is the bet's own handle (consistent with the placement receipt and the wallet DTOs);
  the user-facing ticket reference is `publicRef`. **Never serialized:** `userId`, `marketId`,
  `marketRoundId`, `clientRequestId`, `betId`, `editRequestId`, the ledger idempotency key, any
  sub-document Mongo `_id`.
- `entryMetadata` mirrors the persisted `bets.entryMetadata` shape - `{numbers}` (JODI, the raw
  submitted list) / `{digits}` (CROSSING) / `{rawInput, palti}` (COPY_PASTE). Not authoritative
  over `selections`. The raw composition is retained so the edit screen can reconstruct the
  original method.
- `canEditNow` = `getBettingWindow(...).canEditBet` for the bet's **own** round, AND
  `status === "ACTIVE"` - `false` once `now >= editCutoffAt`, once the round closes, or once the
  bet is settled.
- `result` is the market round's declared 2-char result when present - not a per-bet outcome.
  `winningNumber` / `payoutPaise` / `settledAt` are the per-bet settlement outcome and are
  `null` until the settlement engine exists (Window 7) - never fabricated.
- `walletDeltaPaise` on a revision is `before.totalStakePaise - after.totalStakePaise`:
  negative = the wallet was debited that much, positive = refunded, zero = a same-total edit
  (still recorded, no wallet movement).

**Editing semantics.** An edit is a WHOLE-wager replacement that preserves the bet's identity
(`_id`, `publicRef`, `userId`, `marketId`, `marketRoundId`, `placedAt`,
`payoutMultiplierSnapshot`) and advances only `version` (1 -> 2 -> 3 ...). Everything is
recomputed through the shared `normalizeBetEntry` engine; the payout multiplier snapshot is
**not** refreshed. The wallet moves the **difference only** - `BET_EDIT_DEBIT` of
`newTotal - oldTotal` when larger, `BET_EDIT_REFUND` of `oldTotal - newTotal` when smaller,
nothing when equal. `Bet` update + wallet delta + `BET_EDIT_*` ledger row + `betRevisions`
insert are one MongoDB transaction, re-validated (including the edit cutoff, against a fresh
clock) at the transactional boundary - any partial failure leaves the bet, its version, the
wallet and the ledger unchanged and writes no revision.

**Concurrency.** `expectedVersion` is an optimistic lock: a compare-and-set
`updateOne({ version: expectedVersion, status: "ACTIVE" })` plus the unique
`betRevisions (betId, toVersion)` index mean two edits racing from the same version cannot both
win - the loser gets `409 STALE_VERSION`, never a silent overwrite.

**Idempotency.** `editRequestId` (client UUID) backed by the unique
`betRevisions (userId, editRequestId)` index. A retry of the *same* logical edit returns the
already-applied bet - no second wallet movement, no second version bump - and does so **before**
the cutoff re-check, so a replay after the cutoff returns the previous successful result rather
than `EDIT_WINDOW_CLOSED`. The same id reused for a *different* target wager is
`409 DUPLICATE_REQUEST`.

Deliberate, documented refinements of the "Proposed DTO conventions" sketch, consistent with
Window 4A1/4A2/4A3:

- `stakePaise` (integer paise), not `stakeRupees` decimal text - integer paise end to end.
- `PATCH` takes no `marketSlug` (the API_CONTRACTS sketch's "Entire replacement input" is the
  wager only; an edit cannot re-market a bet) and no `clientRequestId` (that is placement's
  key; editing has `editRequestId`).
- `GET /api/bets/:id` resolves the bet `id` handle OR the `publicRef` (the sketch says
  "resolve publicRef"); knowing a `publicRef` never grants access (`404 BET_NOT_FOUND` for a
  non-owned bet).
- success is `200` with `{ data: ... }` (not `201`), matching every other route here, and
  carries `serverNow`.

## Window 5A - implemented player withdrawal contract

Three route files (`src/app/api/withdrawals/route.ts` - `GET` + `POST`,
`src/app/api/withdrawals/[id]/route.ts` - `GET`, `src/app/api/withdrawals/[id]/cancel/route.ts`
- `POST`). All `apiRoute`-wrapped with the shared `{data:...}` / `{error:{code,message}}` shape,
all requiring an **ACTIVE PLAYER** session via `requirePlayer()` (anonymous -> `401
UNAUTHENTICATED`; **ADMIN** -> `403 FORBIDDEN` - PLAYER-only, not widened; a disabled/deleted
user's stale cookie is rejected by `findActiveSessionUser`), all `export const dynamic =
"force-dynamic"`. Identity is always the authenticated session - **no `userId` is accepted from
the client**. Every response carries `serverNow` (ISO-8601). The `GET`s are exempt from the
same-origin check (matching `GET /api/auth/me`); both `POST`s require a trusted `Origin` (`403`
on mismatch).

The roadmap sequences "Withdrawals" under Window 5; only the **player** backend ships here -
**no withdrawal UI, and no `/api/admin/withdrawals` approve/reject routes** (those are Window
6A; the reusable domain primitives exist but are not routed).

| Route | Request | `200` `data` | Notable errors |
| --- | --- | --- | --- |
| `POST /api/withdrawals` | discriminated on `method`, each branch `.strict()`: `{ method:"UPI", amountPaise: int>0, clientRequestId: uuid, upi:{ upiId } }` / `{ method:"BANK", amountPaise, clientRequestId, bank:{ accountHolderName, accountNumber (6-20 digits), confirmAccountNumber, ifsc (11-char), bankName? } }` | `{ withdrawal: WithdrawalDTO, wallet: WalletView, serverNow }` | `401`, `403` (also cross-origin, ADMIN), `INVALID_INPUT` (400 - bad shape, non-UUID id, **account-number confirmation mismatch**, stray/cross-method field), `INVALID_AMOUNT` (422 - below Rs 1), `MONEY_OUT_OF_RANGE` (422 - beyond safe integer), `INSUFFICIENT_BALANCE` (422 - amount exceeds available balance = the maximum), `DUPLICATE_REQUEST` (409 - `clientRequestId` reused with a different payload) |
| `GET /api/withdrawals` | `?limit=` 1-50 (default 20), `?cursor=` opaque, `?status=PENDING\|APPROVED\|REJECTED\|CANCELLED` (`.strict()`) | `{ withdrawals: WithdrawalDTO[], nextCursor: string \| null, serverNow }` | `401`, `403`, `INVALID_INPUT` (400 - bad limit / stray param / malformed cursor) |
| `GET /api/withdrawals/[id]` | `[id]` = the withdrawal's 24-hex `id` handle (withdrawals have no public reference) | `{ withdrawal: WithdrawalDTO, serverNow }` | `401`, `403`, `WITHDRAWAL_NOT_FOUND` (404 - missing **or** non-owned **or** malformed id, indistinguishable) |
| `POST /api/withdrawals/[id]/cancel` | no body (`.strict()` empty; a stray field is `400`) | `{ withdrawal: WithdrawalDTO, wallet: WalletView, serverNow }` | `401`, `403` (also cross-origin), `WITHDRAWAL_NOT_FOUND` (404 - missing/non-owned), `WITHDRAWAL_NOT_PENDING` (409 - already APPROVED/REJECTED) |

`WithdrawalDTO` =

```text
{ id, method: "BANK"|"UPI", amountPaise, status: "PENDING"|"APPROVED"|"REJECTED"|"CANCELLED",
  destination: { method, summary: "HDFC Bank ••••1234" | "ra••@okhdfcbank" },
  rejectionReason: string | null, requestedAt: iso, decidedAt: iso | null,
  cancelledAt: iso | null, approvedAt: iso | null, rejectedAt: iso | null,
  createdAt: iso, updatedAt: iso }
```

- `id` is the withdrawal's own handle (consistent with the wallet / bet DTOs). **Never
  serialized:** `userId`, `paymentDetails` (raw account number / IFSC / UPI id), `clientRequestId`,
  `decidedByAdminId`, the ledger idempotency key, any sub-document Mongo `_id`.
- `destination.summary` is a **pre-masked** label stored at request time; the raw
  `paymentDetails` is never read on any player path. For BANK, all but the last four account
  digits are masked. The duplicated `bank.confirmAccountNumber` must equal `bank.accountNumber`
  and is **never stored**.
- The schema keeps one generic `decidedAt`; the DTO maps it onto `cancelledAt` / `approvedAt` /
  `rejectedAt` by status (and still returns it raw). `rejectionReason` is non-null only for a
  REJECTED withdrawal.

**Financial semantics.** `POST` atomically transfers `amountPaise` from available to reserved
(`available -= X`, `reserved += X`), creates the `PENDING` withdrawal and appends one immutable
`WITHDRAWAL_RESERVED` `walletTransactions` row - one Mongo transaction, no partial state. The
maximum is the live available balance (`INSUFFICIENT_BALANCE` above it); the minimum is Rs 1
(100 paise). `cancel` atomically transitions `PENDING -> CANCELLED`, returns the reserved money
(`available += X`, `reserved -= X`) and appends one `WITHDRAWAL_RELEASED` row; the withdrawal is
**not** deleted. Reserved funds cannot be bet, withdrawn again or admin-debited while PENDING.

**Idempotency.** `clientRequestId` (client UUID) backed by the unique
`withdrawals (userId, clientRequestId)` index. A retry with the same logical request (method +
amount + destination) returns the **original** withdrawal - no second reserve, no duplicate
ledger row. The same id with a conflicting payload is `409 DUPLICATE_REQUEST`. Two simultaneous
identical requests resolve to one withdrawal / one reserve / one ledger row. Cancellation is
deterministically idempotent on the withdrawal's own state plus the fixed
`WITHDRAWAL_RELEASED:<withdrawalId>` ledger key: an already-CANCELLED withdrawal returns its DTO
with **no** second release, a retried or concurrent cancel releases the reserved money **exactly
once**, and reserved balance never goes negative.

**Future admin (not routed here).** `approveWithdrawalByAdmin` (`PENDING -> APPROVED`, `reserved
-= X` only, `WITHDRAWAL_APPROVED` row, no real payout) and `rejectWithdrawalByAdmin` (`PENDING ->
REJECTED` + reason, `available += X`, `reserved -= X`, `WITHDRAWAL_RELEASED` row) exist as
transaction-scoped domain services for Window 6A's `POST /api/admin/withdrawals/:id/approve` /
`:id/reject`. No admin route, UI or audit wiring is added in Window 5A.

Deliberate, documented refinements of the "withdrawal request / cancel" sketch rows above,
consistent with Windows 4A1-4A4:

- the request carries **`amountPaise`** (integer paise), not `amountRupees` decimal text -
  integer paise end to end; the Rs 1 minimum and safe-integer ceiling are enforced by the
  service (`assertWithdrawalAmount`), so a below-minimum amount is `INVALID_AMOUNT` (422), not a
  generic 400;
- payment details are **grouped** under `bank` / `upi` (mirroring the stored `paymentDetails`
  sub-document) rather than flat, and BANK adds `confirmAccountNumber` (validated, never stored);
- cancellation is `POST /api/withdrawals/[id]/cancel` (the sketch's form), success is `200` with
  `{ data: { withdrawal, wallet, serverNow } }` (not `201`), matching every other route here;
- `[id]` is the Mongo `_id` handle - withdrawals have no human public reference - and knowing an
  id never grants access (`404 WITHDRAWAL_NOT_FOUND` for a non-owned withdrawal).

## Window 6A1 - implemented admin player & wallet contract

Ten route files under `src/app/api/admin/players/`. All `apiRoute`-wrapped with the shared
`{data:...}` / `{error:{code,message}}` shape; all require an **ADMIN** session via
`requireAdmin()` (anonymous -> `401 UNAUTHENTICATED`; **PLAYER** -> `403 FORBIDDEN`); all
`export const dynamic = "force-dynamic"`. Every mutation (`POST` / `DELETE`) also requires a
trusted `Origin` (`403` on mismatch); the `GET`s are exempt (matching the player routes).
Every response carries `serverNow` (ISO-8601). The acting admin is always the authenticated
session - **no admin id or role is accepted from the client**. A missing / malformed / ADMIN
`[id]` is an indistinguishable `404 PLAYER_NOT_FOUND` on every route (admin accounts are
invisible to player management).

Route shape follows the codebase (all mutations are `POST`, not `PATCH`; the sketch's single
`wallet-adjustment` is split into explicit `wallet/credit` + `wallet/debit` mirroring the
`ADMIN_CREDIT` / `ADMIN_DEBIT` ledger types; dedicated read sub-routes replace one composite
payload).

| Route | Request | `200`/`201` `data` | Notable errors |
| --- | --- | --- | --- |
| `POST /api/admin/players` | `.strict()` `{ loginId, name, password, phone?, email? }` — **no `role`** (server-forced PLAYER) | `201` `{ player: AdminPlayerDetail, serverNow }` | `401`, `403` (also cross-origin, PLAYER), `INVALID_INPUT` (400 - bad shape / stray field incl. `role`, `status`, `passwordHash`), `LOGIN_ID_TAKEN` (409), `IDENTIFIER_TAKEN` (409 - phone/email) |
| `GET /api/admin/players` | `?search=` (normalized loginId / email substring, exact phone), `?status=ACTIVE\|DISABLED`, `?limit=` 1-100 (default 25), `?cursor=` opaque (`.strict()`) | `{ players: AdminPlayerListItem[], nextCursor: string\|null, serverNow }` | `401`, `403`, `INVALID_INPUT` (400 - bad limit / stray param / malformed cursor) |
| `GET /api/admin/players/[id]` | `[id]` = 24-hex user id | `{ player: AdminPlayerDetail, serverNow }` | `401`, `403`, `PLAYER_NOT_FOUND` (404) |
| `DELETE /api/admin/players/[id]` | none | `{ purged: true, serverNow }` | `401`, `403` (also cross-origin), `PLAYER_NOT_FOUND` (404 - incl. an ADMIN target) |
| `POST /api/admin/players/[id]/status` | `.strict()` `{ status: "ACTIVE" \| "DISABLED" }` | `{ player: AdminPlayerDetail, serverNow }` | `401`, `403` (also cross-origin), `PLAYER_NOT_FOUND` (404) |
| `POST /api/admin/players/[id]/reset-password` | `.strict()` `{ newPassword }` | `{ reset: true, serverNow }` | `401`, `403` (also cross-origin), `PLAYER_NOT_FOUND` (404) |
| `GET /api/admin/players/[id]/wallet` | none | `{ wallet: WalletView, serverNow }` | `401`, `403`, `PLAYER_NOT_FOUND` (404) |
| `GET /api/admin/players/[id]/wallet/transactions` | `?limit=` 1-100 (default 20), `?cursor=` opaque (`.strict()`) | `{ transactions: AdminWalletTransactionDTO[], nextCursor, serverNow }` | `401`, `403`, `INVALID_INPUT` (400), `PLAYER_NOT_FOUND` (404) |
| `POST /api/admin/players/[id]/wallet/credit` | `.strict()` `{ amountPaise: int>0, reason, paymentReference?, clientRequestId: uuid }` | `{ transaction: { id, type:"ADMIN_CREDIT", amountPaise }, wallet: WalletView, idempotentReplay: bool, serverNow }` | `401`, `403` (also cross-origin), `INVALID_INPUT` (400 - bad shape / empty reason / non-uuid / stray incl. a resulting balance), `INVALID_AMOUNT` (422 - below Rs 1), `MONEY_OUT_OF_RANGE` (422), `DUPLICATE_REQUEST` (409), `PLAYER_NOT_FOUND` (404) |
| `POST /api/admin/players/[id]/wallet/debit` | same as credit | `{ transaction: { id, type:"ADMIN_DEBIT", amountPaise }, wallet: WalletView, idempotentReplay, serverNow }` | as credit, plus `INSUFFICIENT_BALANCE` (422 - would push available below zero) |
| `GET /api/admin/players/[id]/bets` | `?limit=` 1-50 (default 20), `?cursor=`, `?status=ACTIVE\|WON\|LOST`, `?market=<slug>` (`.strict()`) | `{ bets: PlayerBetDTO[], nextCursor, serverNow }` (reuses the sanitized player bet DTO) | `401`, `403`, `INVALID_INPUT` (400), `PLAYER_NOT_FOUND` (404), `MARKET_NOT_FOUND` (404 - unknown `?market`) |
| `GET /api/admin/players/[id]/withdrawals` | `?limit=` 1-50 (default 20), `?cursor=`, `?status=PENDING\|APPROVED\|REJECTED\|CANCELLED` (`.strict()`) | `{ withdrawals: WithdrawalDTO[], nextCursor, serverNow }` (reuses the sanitized player DTO - masked `destination.summary` only) | `401`, `403`, `INVALID_INPUT` (400), `PLAYER_NOT_FOUND` (404) |

`AdminPlayerSummary` = `{ id, loginId, name, phone: string\|null, email: string\|null,
status: "ACTIVE"\|"DISABLED", createdAt: iso, updatedAt: iso }`. **Never serialized:**
`passwordHash`, `createdBy`, `passwordChangedAt`, session / OTP material, `__v`.

`AdminPlayerListItem` = `AdminPlayerSummary` + `{ availableBalancePaise, reservedBalancePaise,
totalBalancePaise, betCount, withdrawalCount }` (wallet + counts batch-loaded via three `$in`
reads — no per-row query).

`AdminPlayerDetail` = `AdminPlayerSummary` + `{ wallet: WalletView }` where `WalletView =
{ currency, availableBalancePaise, reservedBalancePaise, totalBalancePaise }`.

`AdminWalletTransactionDTO` = `{ id, type, amountPaise, availableDeltaPaise, reservedDeltaPaise,
availableBeforePaise, availableAfterPaise, reservedBeforePaise, reservedAfterPaise,
referenceType: string\|null, reason: string\|null, paymentReference: string\|null,
actorAdminId: string\|null, createdAt: iso }`. Exposes the admin operational metadata a future
screen needs but **never** the internal `idempotencyKey`.

**LOCKED V1 manual deposit flow.** There is **no payment gateway** in V1. A player pays the
admin outside Diamond (UPI / cash / bank); the admin verifies it; the admin calls
`wallet/credit`; the system records an immutable `ADMIN_CREDIT`. `wallet/debit` (`ADMIN_DEBIT`)
is the correction mirror — it never pushes available below zero and never touches reserved. The
resulting balance is always computed by the server (`applyWalletMovement`), never accepted from
the request.

**Financial atomicity.** Credit / debit run the wallet balance change + the immutable
`walletTransactions` row + a redacted `auditLogs` row (`ADMIN_WALLET_CREDIT` /
`ADMIN_WALLET_DEBIT`) in **one MongoDB transaction** — any failure moves no money and writes no
partial state.

**Idempotency.** `clientRequestId` (client UUID) → key
`ADMIN_WALLET_ADJUSTMENT:<adminId>:<clientRequestId>`, backed by the unique
`walletTransactions {idempotencyKey}` index. Operation-agnostic: an exact replay returns the
original receipt (`idempotentReplay: true`, no second movement / ledger / audit); the same id
with a different player, operation (credit↔debit), amount, reason or payment reference is
`409 DUPLICATE_REQUEST`. Two simultaneous identical credits resolve to one movement / one
ledger row / one audit row.

**Session invalidation.** `status → DISABLED`, password reset and hard purge each revoke every
one of the player's sessions **inside the same transaction**; `findActiveSessionUser` also
rejects any surviving cookie because the user is no longer ACTIVE (or no longer exists).

**Hard purge (`DELETE`).** Runs `playerDeletionService.purgePlayer()` — one transaction removing
`betRevisions`, `bets`, `withdrawals`, `walletTransactions`, `wallets`, `sessions`,
`otpRequests`, every identifying `auditLogs` row, then the `user`. The only survivor is a
generic `PLAYER_DELETION_COMPLETED` audit row with no player identifier. No tombstone, no
deny-list — the freed `loginId` may later back a brand-new account.

**Not in 6A1** (Window 6A2 / later): admin withdrawal approve/reject routes, market config
mutations, result declaration, game-rate API, a full admin audit browser, settlement. The
Window 5A internal withdrawal decision primitives are unchanged and unrouted.

## Window 6A2 - implemented admin operations contract

Sixteen route files under `src/app/api/admin/` (`withdrawals`, `markets`, `results`, `settings`,
`audit`, `dashboard`, `bets`). All `apiRoute`-wrapped with the shared `{data:...}` /
`{error:{code,message}}` shape; all `requireAdmin()` (anonymous -> `401`, PLAYER -> `403`); all
`export const dynamic = "force-dynamic"`. Every mutation (`POST`) also requires a trusted
`Origin` (`403` on mismatch); the `GET`s are exempt. Every response carries `serverNow`. The
acting admin is always the session - no admin id / role from the client.

| Route | Request (`.strict()`) | `200` `data` | Notable errors |
| --- | --- | --- | --- |
| `GET /api/admin/withdrawals` | `?status`, `?method`, `?search`, `?dateFrom`, `?dateTo`, `?limit` 1-100 (25), `?cursor` | `{ withdrawals: AdminWithdrawalListItem[], nextCursor, serverNow }` | `401`, `403`, `INVALID_INPUT` |
| `GET /api/admin/withdrawals/[id]` | 24-hex id | `{ withdrawal: AdminWithdrawalDetail, serverNow }` | `401`, `403`, `WITHDRAWAL_NOT_FOUND` |
| `POST /api/admin/withdrawals/[id]/approve` | `{ confirmPaid: true, clientRequestId: uuid, paymentReference?, note? }` | `{ withdrawal: AdminWithdrawalListItem, idempotentReplay, serverNow }` | `401`, `403` (also cross-origin), `INVALID_INPUT` (400 - missing/false `confirmPaid`, non-uuid, stray), `WITHDRAWAL_NOT_FOUND`, `WITHDRAWAL_NOT_PENDING` (409), `DUPLICATE_REQUEST` (409) |
| `POST /api/admin/withdrawals/[id]/reject` | `{ reason, clientRequestId: uuid, note? }` | `{ withdrawal, idempotentReplay, serverNow }` | as approve, plus `INVALID_INPUT` for an empty `reason` |
| `GET /api/admin/markets` | `?enabled=true\|false` | `{ markets: AdminMarketDTO[], serverNow }` | `401`, `403` |
| `GET /api/admin/markets/[id]` | 24-hex id | `{ market: AdminMarketDTO, serverNow }` | `401`, `403`, `MARKET_NOT_FOUND` |
| `POST /api/admin/markets/[id]/status` | `{ enabled: boolean }` | `{ market: AdminMarketDTO, serverNow }` | `401`, `403` (also cross-origin), `MARKET_NOT_FOUND` |
| `POST /api/admin/markets/[id]/schedule` | `{ openTime?: HH:MM, closeTime?: HH:MM, closeDayOffset?: 0\|1, editLockMinutesBeforeClose?: int }` (>= 1 field) | `{ market: AdminMarketDTO, serverNow }` | `401`, `403` (also cross-origin), `MARKET_NOT_FOUND`, `INVALID_INPUT` (400 - bad time format / stray / impossible resulting schedule / edit lock >= round length) |
| `POST /api/admin/results/prepare` | `{ marketId: hex24, businessDate?: YYYY-MM-DD, result: 2-char string }` | `{ preview: ResultDeclarationPreview }` | `401`, `403` (also cross-origin), `MARKET_NOT_FOUND`, `ROUND_NOT_FOUND`, `RESULT_TOO_EARLY` (422 - now < closesAt), `INVALID_INPUT` (400 - bad result string) |
| `POST /api/admin/results/declare` | `{ marketId, businessDate?, result, confirm: true, clientRequestId: uuid }` | `{ result: DeclaredResult }` | as prepare, plus `RESULT_ALREADY_DECLARED` (409), `DUPLICATE_REQUEST` (409), `INVALID_INPUT` (400 - missing/false `confirm`) |
| `POST /api/admin/results/settle` | `{ marketId, businessDate?, confirm: true, clientRequestId: uuid }` (NO `result` - cannot change the declared number) | `{ settlement: AdminRoundSettlement }` (Window 7A1 `RoundSettlementSummary` + `market` + `auditWritten`) | `401`, `403` (also cross-origin), `MARKET_NOT_FOUND`, `ROUND_NOT_FOUND` (404), `RESULT_NOT_DECLARED` (422), `INVALID_INPUT` (400 - missing/false `confirm`, stray `result`) |
| `GET /api/admin/settings/rate` | none | `{ payoutMultiplier, currency, minimumStakePaise, serverNow }` | `401`, `403` |
| `POST /api/admin/settings/rate` | `{ payoutMultiplier: int >= 1 }` | `{ payoutMultiplier, previousPayoutMultiplier, changed, currency, minimumStakePaise, serverNow }` | `401`, `403` (also cross-origin), `INVALID_INPUT` (400/422 - non-int / < 1 / > 1000) |
| `GET /api/admin/audit` | `?action`, `?actorAdminId`, `?subjectUserId`, `?entityType`, `?dateFrom`, `?dateTo`, `?limit` 1-100 (25), `?cursor` | `{ logs: AdminAuditLogDTO[], nextCursor, serverNow }` | `401`, `403`, `INVALID_INPUT` |
| `GET /api/admin/dashboard` | none | `AdminDashboard` (see below) | `401`, `403` |
| `GET /api/admin/bets` | `?playerId`, `?market=<slug>`, `?status`, `?entryMethod`, `?businessDate`, `?dateFrom`, `?dateTo`, `?limit` 1-50 (20), `?cursor` | `{ bets: AdminBetDTO[], nextCursor, serverNow }` | `401`, `403`, `INVALID_INPUT`, `MARKET_NOT_FOUND` (unknown `?market`) |
| `GET /api/admin/bets/[id]` | 24-hex `_id` or `publicRef` | `{ bet: AdminBetDetailDTO, serverNow }` | `401`, `403`, `BET_NOT_FOUND` |

**DTOs.**
`AdminWithdrawalListItem` = `{ id, player: { id, loginId, name }, method, amountPaise, status,
destinationSummary (MASKED), rejectionReason: string|null, paymentReference: string|null,
decidedByAdminId: string|null, requestedAt, decidedAt: string|null, createdAt, updatedAt }`.
`AdminWithdrawalDetail` = list item + `{ decisionNote: string|null, payoutDestination, wallet:
WalletView }` where `payoutDestination` is `{ method:"BANK", accountHolderName, accountNumber,
ifsc, bankName: string|null }` **or** `{ method:"UPI", upiId }` - **returned by this one endpoint
only**, never serialized anywhere else, never logged, never in an audit row.
`AdminMarketDTO` = `{ id, name, slug, code, timezone, enabled, schedule: { openTime, closeTime,
openTimeMinutes, closeTimeMinutes, closeDayOffset, editLockMinutesBeforeClose }, displayOrder,
state, currentBusinessDate, currentRound: { id, businessDate, opensAt, editCutoffAt, closesAt,
state, result: string|null, resultDeclaredAt: string|null, settlementStatus } | null }`.
`ResultDeclarationPreview` = `{ market: { id, name, slug, code }, businessDate, closesAt,
proposedResult, currentResult: string|null, alreadyDeclared, settlementStatus,
settlementPerformed: false, warning, serverNow }` (no mutation).
`DeclaredResult` = `{ market, businessDate, result, resultDeclaredAt, declaredByAdminId,
closesAt, settlementStatus, settlementPerformed: false, idempotentReplay, serverNow }`.
`AdminAuditLogDTO` = `{ id, action, entityType, entityId: string|null, actorAdminId,
subjectUserId: string|null, before: object|null, after: object|null, createdAt }` - `before` /
`after` re-redacted on read.
`AdminBetDTO` = the sanitized `PlayerBetDTO` + `{ player: { id, loginId, name } }`;
`AdminBetDetailDTO` = `AdminBetDTO` + `{ revisions: BetRevisionDTO[] }`. READ ONLY.
`AdminDashboard` = `{ players: { active, disabled, total }, wallet: { totalAvailablePaise,
totalReservedPaise }, withdrawals: { pendingCount, pendingAmountPaise }, betsToday: { count,
totalStakePaise, sinceIso }, markets: AdminMarketStatusSummary[], results: { pending, declared },
recentActivity: AdminAuditLogDTO[], serverNow }`.

**Mark Paid & Approve (LOCKED V1 money-out).** The player requests a withdrawal (Window 5A moved
`available -> reserved`, status PENDING). The admin transfers the money **outside Diamond**. Only
**after** the real payment does the admin call `approve` with `confirmPaid: true` - the system
then finalizes the reserved amount (`reserved -= X`, **available unchanged**), flips
`PENDING -> APPROVED`, writes one immutable `WITHDRAWAL_APPROVED` ledger row + a
`WITHDRAWAL_APPROVED` audit row, and records `decidedByAdminId` / `paymentReference` /
`decisionNote` / `decisionRequestId` - all one MongoDB transaction. There is **no** real
bank/UPI payout API and **no** second debit of available.

**Idempotency & concurrency.** Approve / reject: DB-backed on `decisionRequestId` (unique sparse
index) - an exact `(withdrawal, clientRequestId)` replay with the same payload returns the
original; the same id for a different withdrawal / a materially different decision / the opposite
operation is `DUPLICATE_REQUEST`. Concurrent approve||approve, reject||reject, approve||reject and
player-cancel||admin-decision all resolve to exactly one terminal transition, one ledger row, one
audit row, wallet conserved, reserved never negative (the Window 5A CAS on `status:"PENDING"`).
Result declare: DB-backed on `resultDeclaredRequestId`; concurrent declaration by two admins ->
one wins, one result, one audit.

**No settlement in 6A2.** Result declaration records the winning number only. It never changes a
`Bet` status, never writes `WIN_CREDIT`, never moves a wallet, and leaves `settlementStatus` at
`PENDING`. Payout-rate changes affect only future bet placements; every existing
`bets.payoutMultiplierSnapshot` is untouched. Settlement is Window 7A.
