# Architecture and module ownership

Read [CODEX_RULES.md](CODEX_RULES.md) first. These requirements are authoritative and originate from the approved Window 1 brief. DOMAIN_RULES.md owns business rules; the roadmap limits implementation scope. Future-facing descriptions do not imply implemented features.

## ARCHITECTURAL STYLE

Implement a **modular monolith**.

Target architecture:

```text
Next.js
   │
   ├── Player UI
   ├── Admin UI
   ├── Route Handlers / Server Actions
   │
   ▼
Domain Services
   │
   ├── Auth
   ├── Users
   ├── Markets
   ├── Betting
   ├── Wallet
   ├── Withdrawals
   ├── Settlement
   ├── Audit
   └── Settings
   │
   ▼
MongoDB
```

Business rules MUST NOT live inside React components.

API routes/server actions should be thin orchestration layers:

```text
authenticate
validate request
call domain service
return response
```

Do not place 200–300 lines of betting/wallet logic inside route handlers.

## CORE SOURCE STRUCTURE

Use a clean structure along these lines, adapting appropriately if the repo already has a good convention:

```text
src/

  app/
    (auth)/
    (player)/
    admin/
    api/

  modules/

    auth/
      models/
      services/
      validators/
      providers/

    users/
      models/
      services/
      validators/

    markets/
      models/
      services/
      validators/

    betting/
      models/
      services/
      validators/
      engines/

    wallet/
      models/
      services/
      validators/

    withdrawals/
      models/
      services/
      validators/

    settlement/
      services/

    audit/
      models/
      services/

    settings/
      models/
      services/

  components/
    ui/
    shared/
    player/
    admin/

  lib/
    db/
    money/
    dates/
    auth/
    errors/
    utils/

scripts/

docs/
```

Do not force this exact tree if a slightly cleaner equivalent fits Next.js conventions, but preserve the module boundaries.

## PURE BETTING ENGINES — FOUNDATION ONLY

Create clean module boundaries/placeholders and, if appropriate for Window 1, implement small pure utilities that are foundational.

Future engines will include:

```text
jodi.engine.ts
crossing.engine.ts
copy-paste.engine.ts
palti.engine.ts
```

Do NOT rush the full betting feature UI now.

If implementing the pure functions now improves the foundation without expanding scope, add unit tests.

Otherwise establish the interfaces and leave implementation to Window 4.

Do not write placeholder logic that returns fake production-looking values.

## MONEY UTILITIES

Create centralized utilities for:

* INR formatting
* converting validated rupee input to paise
* safe integer arithmetic
* formatting paise to display INR
* rejecting invalid/negative values

Do not sprinkle money formatting logic throughout components.

## DATE / MARKET TIME UTILITIES

Create centralized market-time foundations.

Important future functions include concepts such as:

```text
resolveMarketBusinessDate()
getRoundTimes()
deriveMarketStatus()
isBetPlacementAllowed()
isBetEditAllowed()
```

Disawar cross-midnight logic must be covered by tests.

Use a reliable timezone-aware date library if needed rather than hand-writing fragile timezone math.

Choose a library deliberately and document why.

## ERROR FOUNDATION

Create a centralized domain/application error approach.

Prepare stable error codes such as:

```text
INVALID_CREDENTIALS
USER_DISABLED
MARKET_CLOSED
MARKET_DISABLED
EDIT_WINDOW_CLOSED
INSUFFICIENT_BALANCE
INVALID_SELECTION
STAKE_BELOW_MINIMUM
BET_ALREADY_SETTLED
WITHDRAWAL_NOT_PENDING
DUPLICATE_REQUEST
FORBIDDEN
UNAUTHENTICATED
```

Future UI will map these to human-friendly messages.

Do not expose raw database errors to users.

## PACKAGE DISCIPLINE

Do not install large dependency stacks without reason.

For each non-trivial dependency added, ensure it solves a concrete requirement.

Avoid multiple libraries that solve the same problem.

Examples:

* one clear date/time strategy
* one animation system
* one ODM
* one validation system

Do not add a full state-management framework without need.

## Implemented Window 1 decisions

This repository was an existing minimal Next.js 16 App Router starter, not a new scaffold. Its `src/app`, strict TypeScript, Tailwind 4, ESLint, Geist fonts, MongoDB driver ping script and uncommitted setup work were retained. Dependencies are now pinned; Node 24 LTS is the development baseline and TypeScript targets ES2022 for BigInt intermediates.

| Boundary | Ownership and present implementation |
| --- | --- |
| `src/app` | Root layout, static holding page, global tokens, reduced-motion-aware Motion provider. No authentication or money endpoints yet. |
| `modules/auth` | Session/OTP persistence, mock OTP delivery interface and hashing; Window 2 implements session and login services. |
| `modules/users` | Identity model/normalization, environment-driven initial-admin creation, typed `PlayerDeletionService.purgePlayer` contract. |
| `modules/markets` | Permanent market and daily round models. `lib/dates/market-time.ts` is the sole round-time calculation implementation. |
| `modules/betting` | Canonical bet and revision models, input discriminated union, engine contracts. Engines and mutation services remain Window 4. |
| `modules/wallet` | Wallet and delta-ledger models, future sole-writer `WalletService.applyMovement` contract. |
| `modules/withdrawals` | Withdrawal persistence + the **player** lifecycle (request / own list / detail / cancel) and the transaction-scoped **admin approve / reject primitives** (Window 6A routes those). See "Window 5A". |
| `modules/settlement` | Batch service contract; implementation in Window 7. No simulated settlement. |
| `modules/audit` | Canonical audit model; future service must allowlist/redact snapshots and tag player associations. |
| `modules/settings` | Singleton model, seed defaults and non-overwriting seed service. |
| `lib/db` | Server-only reusable Mongoose connection, topology check, transaction wrapper, schema helpers, model/index registry. |
| `lib/money`, `lib/errors`, `lib/config`, `lib/auth` | Exact paise operations, public error mapping, lazy environment validation and scrypt password hashing. |

Only `providers.tsx` is a Client Component. Models, database, environment, passwords and OTP provider import `server-only`; CLI scripts use Node's `react-server` condition to load those same server modules. Tests alias only that marker to an empty Node test file. This does not disable the marker in the app build. Keep database code on the Node runtime.

### Money representation

Persist `number` values only within `Number.isSafeInteger`, in paise. BSON Number stores this bounded integer subset exactly. No authoritative decimal rupee arithmetic occurs. Decimal input is a string parsed with BigInt; addition and multiplication use BigInt intermediates and reject overflow before conversion back to number. INR formatting also avoids division through binary floating point. Signed ledger deltas use the same safe range; balances are nonnegative. The precision ceiling is a technical limit, not a configured maximum stake/deposit. Check derived payout and aggregate overflow before any financial write. Current rate is a positive integer multiplier; fractional-rate representation is not defined by this prototype and must be clarified before supporting it.

### Time strategy

Luxon is the one date/time library: explicit IANA timezone, validated ISO business dates and calendar-day rollover. Persist UTC Date instants plus local `YYYY-MM-DD` business date. Market rows supply all schedule data. `getRoundTimes` snapshots the schedule; existing round timestamps must not be silently recomputed when an admin changes future market schedules.

Placement interval is `[opensAt, closesAt)`. Editing also requires an ACTIVE bet and `now < editCutoffAt`. CLOSING_SOON currently means the edit-locked interval, not a new placement cutoff. Disawar before 03:00 belongs to yesterday's open round. At/after 03:00 until 07:00 the business-date resolver selects today's upcoming round; the previous closed round remains explicitly queryable for results/settlement. This is a round-selection convention, not loss of history. Server services pass one authoritative time; UI countdowns are only presentation.

### Deferred transactional implementation

Future routes authenticate, strictly parse Zod input, call a domain service, then return a public DTO. Do not export hydrated documents or raw errors. Financial services must read persisted settings/rounds/bets/wallets and recalculate counts, totals, available funds, edit eligibility and payouts. Compare-and-update filters and unique indexes must enforce state/version transitions inside transactions. Mongoose document validation is a backstop: query updates, `$inc`, bulk writes and direct MongoDB access do not automatically run these document hooks or protect against races.

Keep writes sequential inside `withTransaction`. A retryable callback must not send OTP, write external files, or emit a response. Catch duplicate keys outside the aborted transaction, reread the original operation and verify payload equivalence. Reuse with a different payload is DUPLICATE_REQUEST, not a second movement. Ownership must be checked even when a public reference is known.

Player deletion must coordinate with wallet/bet/settlement/auth writes so no concurrent operation recreates orphan data. A common user-document write/version guard shared by future player mutations and purge is a candidate; the actual deletion service is deferred, not claimed race-safe now. Purge by subjectUserId and known entity associations, including identifying audit snapshots. Never store secrets in audit payloads. Aggregated round summaries must contain no player identifiers; re-evaluate aggregates consistently during purge.

### Dependency rationale and deliberate deferrals

Mongoose is the single ODM; Zod validates inputs/configuration; Luxon handles market calendars; Motion is the single animation provider; server-only prevents client imports; tsx runs TypeScript scripts; Vitest runs domain tests; @types/luxon supplies static types. Node crypto supplies scrypt/HMAC without another auth package. The existing mongodb dependency is retained for the user's diagnostic script. React Hook Form and shadcn primitives will be added when actual forms/components in Window 2 benefit; no unused form/state framework was installed.

References checked for implementation: [Mongoose transactions](https://mongoosejs.com/docs/transactions.html), [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/), [Node crypto](https://nodejs.org/api/crypto.html). These technical references do not change frozen product rules.

The separate integration suite uses mongodb-memory-server-core to start a disposable local replica set and verify real unique indexes, seed reruns, admin credentials and multi-document rollback/commit. Unit tests do not need MongoDB or a binary download. The integration dependency is test-only and does not provision application infrastructure.

## Window 2B: auth module layout and route protection

`modules/auth` gained the service/validator layers the target structure at the top of this document anticipated, all thin and reused rather than duplicated per route:

```text
modules/auth/
  config.ts                 # cookie name, session duration, OTP expiry/attempts/cooldown — no secrets, importable by client code too
  services/
    session.service.ts      # token generate/hash, createSession, findActiveSessionUser, revokeSessionByToken, revokeAllUserSessions
    login.service.ts         # loginWithPassword — shared by both portals, server enforces the role match
    otp.service.ts           # requestPlayerOtp, verifyPlayerOtp
  validators/auth-input.ts   # Zod: loginRequestSchema, otpRequestSchema, otpVerifySchema
  models/, providers/         # unchanged from Window 1
```

`lib/auth/session.ts` is the framework-coupled layer above it — `next/headers` cookies, `next/server` cookie writes, and the reusable `getCurrentUser`/`requireAuthenticatedUser`/`requirePlayer`/`requireAdmin` primitives — kept separate from `modules/auth` so the domain services stay framework-agnostic and directly reusable from the integration test suite and future scripts. `lib/http/same-origin.ts` and `lib/api/handler.ts` are small, deliberately shared (not per-route) building blocks: the former is the CSRF/same-origin check, the latter gives every route handler identical Zod/DomainError-to-JSON translation instead of five copies of the same try/catch.

Route handlers under `src/app/api/auth/**/route.ts` stay thin per CODEX_RULES: parse with Zod, `connectDatabase()`, call one domain service, shape the response — no password/session/Mongo logic lives in a route file.

Protected areas use Next.js route groups specifically so the public login pages cannot be caught by their sibling protected layout:

```text
src/app/(player)/layout.tsx, page.tsx   → "/"        (auth-checked; group folder is invisible in the URL)
src/app/login/page.tsx                  → "/login"   (public; NOT inside the (player) group)
src/app/admin/(protected)/layout.tsx, page.tsx → "/admin"        (auth-checked)
src/app/admin/login/page.tsx                   → "/admin/login" (public; a sibling of (protected), not inside it)
```

A layout nested directly under `admin/` would also wrap `admin/login`, risking a redirect loop; the `(protected)` group avoids that entirely rather than special-casing the login path inside the guard.

## Window 3A: markets, rounds, server-authoritative scheduling and result read services

Backend/domain only. No player Home, market cards or Results UI were built — a later Codex visual window consumes these services/APIs. No betting, wallet, admin CRUD or settlement was started. Window 2A's visual design remains pending a dedicated Codex visual refinement pass; this window did not touch it.

### Module layout

```text
lib/dates/market-time.ts        # unchanged Window 1 functions + new: getBettingWindow(), MarketLifecycleState/BettingWindow types
modules/markets/
  models/                        # market.model.ts, market-round.model.ts — unchanged shapes; added InferSchemaType exports + one index
  validators/market-query.ts     # Zod: marketSlugSchema, resultRangeSchema ("today"|"7d"|"30d"), resultsQuerySchema (.strict)
  services/
    market.service.ts            # listMarkets/listEnabledMarkets, getMarketBySlug, marketScheduleOf, ensureMarketRound,
                                  #   currentBusinessDate, resolveCurrentRound, resolveCurrentRoundsForMarkets,
                                  #   getMarketWithCurrentRound, getMarketsWithCurrentRounds, roundStateOf
    result.service.ts            # historyWindow, getCurrentResults, getResultHistory
    market-dto.ts                # toMarketDTO — the only market/round shape sent to a browser
src/app/api/markets/route.ts             # GET  (ACTIVE PLAYER)
src/app/api/markets/[slug]/route.ts      # GET  (ACTIVE PLAYER)
src/app/api/results/route.ts             # GET  (ACTIVE PLAYER)
```

Route handlers stay thin exactly as the auth routes do: `requirePlayer()` (from `lib/auth/session.ts` — reused, no per-route cookie parsing), parse query with Zod, call one service, serialize a DTO. `lib/api/handler.ts`'s `apiRoute()` wrapper is now variadic so it forwards Next's route `context` (`{ params }`) to the `[slug]` handler unchanged; existing callers are unaffected. All three GETs are `export const dynamic = "force-dynamic"` — they read the session cookie and the database every call.

### Permanent market vs daily round

`Market` (persistent config: schedule minutes, `closeDayOffset`, `editLockMinutesBeforeClose`, `enabled`, `displayOrder`) → `MarketRound` (one business date). All six schedules originate from `markets` rows seeded by `modules/settings/seed-data.ts`; nothing is hardcoded in a service or component. Model shapes are unchanged from Window 1.

`ensureMarketRound(market, businessDate)` is the single create-or-get:

1. `findOne({ marketId, businessDate })` — return it if present.
2. Else `getRoundTimes(marketScheduleOf(market), businessDate)` and `MarketRound.create(...)` with a snapshot of `opensAt`/`editCutoffAt`/`closesAt` plus `settlementStatus: "PENDING"`.
3. On a create race the unique `(marketId, businessDate)` index throws E11000; catch it, re-read, return the winner. Concurrency is proven by an 8-way `Promise.all` integration test asserting one `_id` and `countDocuments === 1`.

Timestamps are snapshotted at creation and **never recomputed**. An admin schedule edit (Window 6) changes only future rounds; an integration test mutates `closeTimeMinutes` and asserts the existing round's `closesAt` is unchanged while the next date's round uses the new value.

Rounds are created only when operationally needed — resolving a market's *current* round. History queries never manufacture rounds: a 30-day results query reads persisted rows and simply has no entry for days without data.

### Current-round resolution — canonical semantics

`resolveCurrentRound(market, now)` returns `{ businessDate, round, state, bettingWindow }`:

| Situation | `round.businessDate` | `state` |
| --- | --- | --- |
| before open | today (IST) | `UPCOMING` |
| open, > 60 min to close | today | `OPEN` |
| open, ≤ 60 min to close (edit-locked) | today | `CLOSING_SOON` |
| after same-day close, no result | today | `RESULT_PENDING` |
| Disawar 00:00–02:59:59 IST | **previous** calendar date | `OPEN` / `CLOSING_SOON` |
| Disawar 03:00–06:59:59 IST | new calendar date | `UPCOMING` |

The Disawar rows reuse Window 1's `resolveMarketBusinessDate`: the overnight round owns every instant in `[opensAt, closesAt)`, so at exactly `closesAt` (03:00 IST) the resolver flips to the new date's upcoming round. The just-closed round is **not** "current" but stays fully queryable by `(marketId, businessDate)` for results/settlement — this is a round-selection convention, not loss of history. A disabled market resolves to `round: null` + `state: "DISABLED"` and **no round is persisted** for it.

`resolveCurrentRoundsForMarkets(markets, now)` is the batched form for the listing: one `$or` read over the unique index, then a targeted insert only for dates not yet persisted (≈6 inserts on the day's first request, 0 afterwards) — no per-market `findOne`, no aggregation pipeline.

### Market state derivation

`deriveMarketStatus(enabled, roundState, now)` is unchanged from Window 1 and stays the authority: `DISABLED → SETTLED → RESULT_DECLARED → UPCOMING → RESULT_PENDING → CLOSING_SOON → OPEN`. `CLOSING_SOON` is the edit-locked interval `[editCutoffAt, closesAt)` — the precise threshold this repo's "Time strategy" section already froze — **new bets are still allowed in it**; it is not a new placement cutoff and no new business-rule threshold was invented. The API exposes exact `opensAt`/`editCutoffAt`/`closesAt` instants plus `serverNow` so the later frontend can render countdown urgency itself.

### Betting-window helper (Window 4 contract)

`getBettingWindow(enabled, round | null, now): { canPlaceBet, canEditBet, reason? }` — one reusable gate Window 4's betting/edit services call instead of re-deriving boundary checks. Same boundaries as `isBetPlacementAllowed`/`isBetEditAllowed`:

```text
canPlaceBet = enabled AND round AND now ∈ [opensAt, closesAt) AND result absent AND settlement PENDING
canEditBet  = canPlaceBet AND now < editCutoffAt
reason      = MARKET_DISABLED | ROUND_NOT_FOUND | MARKET_NOT_OPEN | MARKET_CLOSED | EDIT_WINDOW_CLOSED (most relevant block)
```

Equality boundaries are frozen in unit tests: at exactly `closesAt` the market is closed for new bets; at exactly `editCutoffAt` editing is locked while new bets continue. The helper answers the *market/round* question only — Window 4 still adds per-bet `ACTIVE` status and `expectedVersion` checks. No bet is persisted in this window.

### DTOs and serialization

`toMarketDTO(market, resolved)` and the result services emit only: ISO-8601 UTC instants, `businessDate` as `YYYY-MM-DD`, `result` as a 2-character string (`"07"` stays `"07"`) or `null`, plus `state`, `settlementStatus`, and `canPlaceBet`/`canEditBet`/`unavailableReason`. No `declaredByAdminId`, no schedule-minute fields, no Mongo internals. Each response carries `serverNow`.

### Result read model

No `resultHistory`/`wins` collection — everything derives from `marketRounds`. `result` is persisted only once declared (the two-digit setter rejects `null`), so `getResultHistory` filters on `{ result: { $exists: true } }` (a `$ne: null` query would run that setter on `null` and throw). History windows are inclusive IST calendar ranges ending on `now`'s business day (`7d` = today + preceding 6; `30d` = today + preceding 29), computed with Luxon and `Asia/Kolkata` — never browser/UTC locale — and capped at today so a future-dated round cannot leak in. `range=today` returns each market's current operational round (result may be `null`/pending); cross-midnight markets follow the resolution table above.

### Errors

Added stable codes `MARKET_NOT_FOUND` (404), `MARKET_NOT_OPEN` (422), `ROUND_NOT_FOUND` (404), `INVALID_RESULT_RANGE` (400) to `lib/errors/domain-error.ts`. `MARKET_DISABLED`/`MARKET_CLOSED`/`EDIT_WINDOW_CLOSED` already existed and are reused verbatim — no synonymous codes.

## Window 4A1: bet normalization engines and read-only quote

Backend / domain only. Jodi, Crossing, Copy Paste and Palti engines; canonical selection normalization; stake and payout calculation; and a server-authoritative `POST /api/bets/quote`. **No bet placement, no wallet read or debit, no ledger, no bet document write, no bet editing, no ticket, no betting UI.** Window 2A's visual design remains pending a dedicated Codex visual refinement pass; this window built no UI.

### Module layout

```text
modules/betting/
  engines/                       # PURE — no db, wallet, clock, persistence, React
    selection.ts                 # canonical two-char helpers: TWO_DIGIT, assertTwoDigit,
                                 #   reverseTwoDigit, dedupePreservingOrder
    jodi.engine.ts               # normalizeJodi(numbers) -> string[]
    crossing.engine.ts           # generateCrossing(digits) -> { uniqueDigits, uniqueDigitCount, numbers }
    copy-paste.engine.ts         # parseCopyPaste(rawInput) -> string[] (ordered, dupes kept)
    palti.engine.ts              # expandPalti(numbers) -> string[]
    normalize.ts                 # normalizeBetEntry(input, stakePaise, minimumStakePaise) -> NormalizedBetEntry
    types.ts                     # NormalizedBetEntry, BetEntryMetadata, BetEngineMetadata, EntryMethod
    contracts.ts                 # NormalizeBet (return widened to NormalizedBetEntry), ApplyPalti
  validators/quote-input.ts      # Zod discriminated union quoteRequestSchema + toEntryInput()
  services/quote.service.ts      # quoteBet(request, now) -> BetQuote  (server-only)
modules/settings/services/platform-settings.service.ts   # getPlatformSettings() read-only (server-only)
src/app/api/bets/quote/route.ts  # POST (ACTIVE PLAYER), same-origin, thin
```

### Pure engines

The engines carry no `server-only` marker on purpose — they are environment-agnostic and reusable by the quote service, future placement, future bet editing, tests and ticket reconstruction. They never query MongoDB, inspect the wallet or the clock, call React, generate a public reference or create a bet. Parsing lives here, never in a route handler, so quote and later placement/edit cannot drift to different parsers.

- **Deterministic ordering.** Crossing preserves the first-appearance order of deduplicated input digits and never re-sorts the generated pairs. Copy Paste and Palti preserve first-occurrence order. Documented as a contract in DOMAIN_RULES.md so a later builder UI can rely on it.
- **Duplicate rule.** All three methods collapse duplicates (first occurrence kept). Documented; not a rejection.
- **Canonical vs source.** `NormalizedBetEntry.selections` is the authoritative wager. `entryMetadata` mirrors the strict `bets.entryMetadata` sub-document (`{numbers}` | `{digits}` | `{rawInput, palti}`) for audit / ticket / revision reconstruction only. `engineMetadata` (`uniqueDigits`, `uniqueDigitCount`, `parsedNumbers`) is non-persisted UI convenience so a screen can say "Using unique digits 4, 2, 8" without re-running business logic. Settlement will only ever read `selections` — it never needs to re-run Crossing or Palti.
- **Money.** Integer paise throughout. `normalizeBetEntry` reuses `lib/money`'s `safeMultiply` for `totalStakePaise` and rejects any non-safe-integer or overflowing arithmetic (`MONEY_OUT_OF_RANGE`). The per-selection minimum is passed in from settings (`STAKE_BELOW_MINIMUM` below it) — no literal `100` in the engine.

### Quote service

`quoteBet(request, now)`:

1. `getPlatformSettings()` — `payoutMultiplier` and `minimumStakePaise` come from the persisted singleton, never a literal.
2. `normalizeBetEntry(...)` — pure; fails fast on bad input with no market round-trip.
3. `getMarketWithCurrentRound(slug, now)` (Window 3A) — resolves the server-authoritative current round and may create the day's operational `MarketRound`. This is the **only** write a quote performs; no bet / wallet / ledger document is ever written. `MARKET_NOT_FOUND` for an unknown slug.
4. Gate on `getBettingWindow(...).canPlaceBet` (Window 3A helper, reused — no re-derived boundary maths). New bets are allowed on `[opensAt, closesAt)`; at exactly `closesAt` the quote fails `MARKET_CLOSED`; during the edit-locked `CLOSING_SOON` interval it still succeeds and the response carries `editableAfterPlacing: false`. Blocked states map to the `getBettingWindow` reason verbatim (`MARKET_DISABLED` / `ROUND_NOT_FOUND` / `MARKET_NOT_OPEN` / `MARKET_CLOSED`).

The quote never touches the wallet — balance is a later window and placement validates funds atomically. `perWinningSelectionCreditPaise = stakePerSelectionPaise × payoutMultiplier`. The response includes `marketRoundId` so later placement can name the intended round, and `binding: false` to make its advisory nature explicit; placement must still revalidate server-side.

### Errors

No new codes. `INVALID_SELECTION` (422) covers every malformed entry (Jodi value, Crossing digits, Copy Paste token, Palti input); `STAKE_BELOW_MINIMUM` (422) / `MONEY_OUT_OF_RANGE` (422) cover stake; `MARKET_NOT_FOUND` / `MARKET_DISABLED` / `MARKET_NOT_OPEN` / `MARKET_CLOSED` / `ROUND_NOT_FOUND` are reused from Window 3A. Zod failures on the route are `400 INVALID_INPUT` via `apiRoute`. Raw Mongo/Zod detail never crosses the HTTP boundary.

### Route

`POST /api/bets/quote` — `export const dynamic = "force-dynamic"`; `isTrustedOrigin` (same-origin CSRF guard, matching the auth mutation routes) → `requirePlayer()` (ACTIVE PLAYER; an ADMIN session is `403 FORBIDDEN`, an anonymous one `401 UNAUTHENTICATED` — the PLAYER-only boundary is not widened) → `quoteRequestSchema.parse` → `quoteBet` → `{ data: BetQuote }`. No `clientRequestId` / idempotency key (that belongs to placement); repeated identical quotes simply return equivalent results for the same server state.

### Idempotency / reusability

`normalizeBetEntry` is the single normalization entry point the future bet-place and bet-edit services must reuse, so quote and placement can never diverge. The `NormalizeBet` contract return type was widened from `readonly NormalizedSelection[]` to the full `NormalizedBetEntry` for this reason.

## Window 4A2: wallet core, immutable ledger, transaction-safe balance movement, mock deposit, player wallet reads

Backend / financial domain only. The wallet layer that upcoming bet placement, bet editing,
withdrawals, settlement and admin adjustments all reuse. **No `Bet.create`, no public bet ref,
no bet placement/edit endpoint, no `BetRevision`, no `withdrawals` document or API, no admin
wallet API/UI, no settlement, no real payment gateway, no wallet UI, no visual work.** Window
2A's visual design remains pending a dedicated Codex visual-browser refinement pass; this
window built no UI.

### Module layout

```text
lib/errors/domain-error.ts        # + WALLET_NOT_FOUND (404), INVALID_AMOUNT (422)
modules/wallet/
  models/
    wallet.model.ts               # unchanged shape; + WalletRecord / WalletDoc type exports
    wallet-transaction.model.ts   # unchanged shape; + WalletTransactionType / WalletTransactionRecord /
                                  #   WalletTransactionRow / WalletTransactionDoc type exports
  services/
    wallet.service.ts             # THE sole balance writer + reusable primitives (server-only)
    mock-deposit.service.ts       # standalone Mock Deposit — owns its transaction, idempotent recovery
    wallet-transactions.service.ts# bounded player ledger read + DTO + opaque cursor
  validators/wallet-input.ts      # Zod: mockDepositSchema, walletTransactionsQuerySchema (.strict)
src/app/api/wallet/route.ts             # GET  (ACTIVE PLAYER)
src/app/api/wallet/mock-deposit/route.ts# POST (ACTIVE PLAYER, same-origin)
src/app/api/wallet/transactions/route.ts# GET  (ACTIVE PLAYER)
```

`src/modules/wallet/services/wallet.contract.ts` (Window 1's `WalletService.applyMovement`
sketch) is **removed** — it is now the implemented `wallet.service.ts`, and a redundant
re-export file would be the kind of abstraction CODEX_RULES #19 forbids. It had no importers.

### Two layers: the primitive and the named wrappers

`applyWalletMovement(input, session)` is the **transaction-scoped primitive** and the only code
that mutates a `wallets` balance. It MUST be called with a `ClientSession` a higher-level
service owns — so Window 4A3 can make `Bet.create` + wallet debit + `walletTransactions` insert
one atomic transaction — and it never opens its own transaction. It:

1. `assertMovementAmount` (whole paise, ≥ 1, safe integer) and derives the deltas from
   `movementDeltas(type, amountPaise)` — the frozen type→movement table.
2. Idempotency pre-check: an already-committed `walletTransactions` row with this key returns
   its result with `idempotentReplay: true` and **no** second mutation; a row with a different
   `type`/`amount`/`user` is `DUPLICATE_REQUEST`.
3. One conditional `Wallet.findOneAndUpdate` — a debit filters `availableBalancePaise >= amount`
   (reserved debits `reservedBalancePaise >= amount`) and `$inc`s both buckets. `null` result
   → `INSUFFICIENT_BALANCE` (wallet exists) or `WALLET_NOT_FOUND`.
4. `WalletTransaction.create([...], { session })` with `before = after − delta` for both
   buckets; the model's `pre("validate")` reconciles it independently.

Named ergonomic wrappers (Window 4A2 brief §8), each type-narrowed:
`creditAvailableInSession` (MOCK_DEPOSIT | BET_EDIT_REFUND | WIN_CREDIT | ADMIN_CREDIT),
`debitAvailableInSession` (BET_PLACED | BET_EDIT_DEBIT | ADMIN_DEBIT), `reserveInSession`
(WITHDRAWAL_RESERVED), `releaseReservedInSession` (WITHDRAWAL_RELEASED),
`finalizeReservedInSession` (WITHDRAWAL_APPROVED). Plus `createPlayerWallet`, `getWalletDoc`,
`getWalletView` (lazy-ensures a ₹0 wallet, never grants funds), `toWalletView`,
`getTransactionByIdempotencyKey`.

### Concurrency

The conditional `findOneAndUpdate` is the whole race protection — no read-modify-write in JS.
Under `readConcern: "snapshot"` two racing debits both pass their (stale) snapshot's guard, the
first commits, the second hits a write conflict, and `withTransaction`'s retry re-runs the
callback against the now-lower balance where the guard fails → `INSUFFICIENT_BALANCE`. Proven
by an integration test: available `10000`, two concurrent `8000` debits → one succeeds, one
`INSUFFICIENT_BALANCE`, final `2000`, exactly one ledger row, never negative (and a 6-racer
`4000`-debit variant lands on exactly `2000`).

### Idempotency and partial-failure safety

A concurrent, not-yet-committed duplicate collides on the unique `idempotencyKey` index at
insert time (E11000). A **standalone** caller (Mock Deposit) catches that *outside* the aborted
transaction, re-reads the original row, verifies payload equivalence and returns the original
receipt — so an HTTP retry, a Mongo internal transaction retry, or two truly simultaneous
requests all credit exactly once. Because the balance `$inc` and the ledger insert are in the
same transaction, there is never "balance moved, ledger missing" or the inverse.

### Mock Deposit

`mockDeposit({ userId, amountPaise, clientRequestId })` — checks
`platformSettings.mockDepositEnabled` (`FORBIDDEN` if off), `assertMockDepositAmount` (≥ 100
paise = ₹1, no maximum, `MONEY_OUT_OF_RANGE` beyond safe integer), `createPlayerWallet`
(idempotent ₹0), then wraps `applyWalletMovement(type: "MOCK_DEPOSIT")` in its own
`withTransaction`. `idempotencyKey = MOCK_DEPOSIT:<userId>:<clientRequestId>`.

### Player read APIs

`GET /api/wallet` → `{ wallet: { currency, availableBalancePaise, reservedBalancePaise,
totalBalancePaise }, serverNow }` — `totalBalancePaise` is derived (`available + reserved`),
never persisted. `GET /api/wallet/transactions` → newest-first, **always bounded**
(`?limit=` 1–100 default 20, opaque `?cursor=` carrying the last row's `(createdAt, _id)` for
gap/overlap-free paging). The ledger DTO exposes `type`, `amountPaise`, both deltas, both
before/after pairs, `referenceType` and `createdAt` only — never `idempotencyKey`,
`createdByAdminId`, `walletId` or `userId`. Both routes derive identity from
`requirePlayer()`; a client `userId` is never trusted; an ADMIN session is `403`.

### Reuse contract for later windows

Window 4A3 bet placement calls `debitAvailableInSession({ session, userId, amountPaise,
type: "BET_PLACED", idempotencyKey, referenceType, referenceId })` inside its own transaction —
the wallet validates funds, debits once, ledgers immutably, and participates in the caller's
transaction, but knows nothing about bets (the dependency is Bet → Wallet, never the reverse;
`referenceType`/`referenceId` carry the generic link). Bet edit uses `BET_EDIT_DEBIT` /
`BET_EDIT_REFUND`; settlement uses `WIN_CREDIT`; withdrawals use reserve/release/finalize;
admin uses `ADMIN_CREDIT` / `ADMIN_DEBIT` — all already implemented and tested as primitives,
with none of their higher-level workflows built.

## Window 4A3: bet placement service, atomic Bet + Wallet + Ledger, public reference, idempotency

Backend / financial domain only. The server-authoritative confirmation of a real player wager.
**No bet editing, no `BetRevision`, no My Bets / ticket UI, no PNG/PDF, no wallet UI, no
withdrawal workflow, no admin CRUD, no result declaration, no settlement, no payout credit, no
visual redesign.** Window 2A's visual design remains pending a dedicated Codex visual-browser
refinement pass; this window built no UI.

### Module layout

```text
modules/betting/
  models/bet.model.ts                     # + BetRecord / BetDoc type exports (no schema/index change)
  validators/place-bet-input.ts           # placeBetRequestSchema (Zod discriminated union, each branch .strict()),
                                          #   PlaceBetRequest, toPlaceEntryInput — quote body + clientRequestId, same field names
  services/
    public-ref.ts                          # generatePublicRef(marketCode, businessDate), PUBLIC_REF_ALPHABET,
                                          #   businessDateRefComponent, PUBLIC_REF_MAX_ATTEMPTS (server-only)
    bet-placement.service.ts               # placeBet(input, options?) -> BetPlacementReceipt; betMatchesRequest (server-only)
modules/settings/services/platform-settings.service.ts   # getPlatformSettings(session?) — optional ClientSession, backward-compatible
src/app/api/bets/route.ts                  # POST (ACTIVE PLAYER, same-origin, thin, force-dynamic)
```

`src/lib/errors/domain-error.ts` is unchanged — `MARKET_NOT_OPEN` / `MARKET_CLOSED` /
`MARKET_DISABLED` / `ROUND_NOT_FOUND` / `MARKET_NOT_FOUND` / `INSUFFICIENT_BALANCE` /
`DUPLICATE_REQUEST` / `STAKE_BELOW_MINIMUM` / `INVALID_SELECTION` / `MONEY_OUT_OF_RANGE` already
exist and are reused verbatim; no synonymous codes were added.

### Layering

```text
API (thin route)  ->  Zod (placeBetRequestSchema)  ->  BetPlacementService.placeBet
      |
shared normalization engine (normalizeBetEntry) . market/round service (Window 3A) .
platform settings . wallet transaction primitive (debitAvailableInSession)
      |
one Mongo transaction (withTransaction)
```

The wallet never imports betting; betting depends on the wallet (`Bet -> Wallet`, never the
reverse — `referenceType: "BET"` / `referenceId` carry the generic link). No circular imports.

### `placeBet(input, options?)`

`input = { userId, request }`. `options` is a test seam only — `{ clock?, generatePublicRef? }`,
production passes neither. `clock` is the injectable authoritative time source and
`generatePublicRef` lets a test force a persistence failure or a collision.

1. **Read settings, normalize.** `getPlatformSettings()` for `minimumStakePaise`;
   `normalizeBetEntry(toPlaceEntryInput(request), request.stakePaise, minimumStakePaise)` — the
   shared pure engine, fail-fast on bad input (`INVALID_SELECTION` / `STAKE_BELOW_MINIMUM` /
   `MONEY_OUT_OF_RANGE`) with no database round-trip. `getMarketBySlug` (`MARKET_NOT_FOUND`).
2. **Existing-success idempotency recovery FIRST.** `Bet.findOne({ userId, clientRequestId })`.
   If found: `betMatchesRequest` compares the canonical logical wager (market id, entry method,
   ordered canonical selections, per-selection stake, totals — which also captures Palti, since
   it changes the selection set; cosmetic raw-input differences that normalize identically are
   equal). Equivalent -> build the receipt from the persisted bet and return **without**
   re-checking the close time and **without** a second debit. Different -> `DUPLICATE_REQUEST`.
3. **Resolve the current round** via `resolveCurrentRound(market, clock())` (Window 3A — may
   create the day's operational `MarketRound`, the only pre-transaction write) and gate on
   `getBettingWindow(...).canPlaceBet`; a blocked reason maps to its verbatim error code.
4. **`createPlayerWallet(userId)`** — idempotent ₹0, never grants funds, so a fund-less player
   gets `INSUFFICIENT_BALANCE` (a real domain answer) rather than `WALLET_NOT_FOUND`.
5. **Pre-allocate `betId = new Types.ObjectId()`**, then one `withTransaction`:
   - fresh `now = clock()`; re-read market + round **in the session**; re-run
     `getBettingWindow` against `now` — the authoritative check at the transactional boundary
     (a retry after real close fails here);
   - `getPlatformSettings(session)` -> `payoutMultiplierSnapshot` (point-in-time under
     `readConcern: "snapshot"`);
   - `debitAvailableInSession({ type: "BET_PLACED", amountPaise: totalStakePaise,
     idempotencyKey: BET_PLACED:<betId>, referenceType: "BET", referenceId: betId }, session)` —
     **debit precedes the insert** so a bet-write failure demonstrably rolls the wallet back;
   - pick a free `publicRef` (`Bet.exists({ publicRef }).session(session)`, bounded
     `PUBLIC_REF_MAX_ATTEMPTS`), build + `validate()` the `Bet` document, then insert it with the
     **native driver** (`Bet.collection.insertOne(doc.toObject(), { session })`). A Mongoose
     document created in the session is reset by `connection.transaction()` on any retry, and
     resetting the `strict:"throw"` `entryMetadata` sub-document throws — the plain insert
     avoids that while the unique `bets.publicRef` and `(userId, clientRequestId)` indexes stay
     the real backstop.
6. **After commit** re-read the bet + round and return `buildReceipt(bet, market, round,
   getWalletView(userId), now)` — the DTO is built from persisted state.
7. **Lost `(userId, clientRequestId)` race** (two simultaneous identical requests): the loser's
   insert hits the unique index, its whole transaction (debit included) rolls back, and the
   `catch` recovers the winner outside the aborted transaction (`Bet.findOne` +
   `betMatchesRequest` -> receipt, or `DUPLICATE_REQUEST`).

### Receipt DTO — `BetPlacementReceipt`

```text
{ bet: { id, publicRef, market: {name, slug, code}, businessDate, entryMethod, entryMetadata,
         selections: [{number, stakePaise}], totalSelections, totalStakePaise,
         payoutMultiplierSnapshot, status, version, placedAt, editCutoffAt, closesAt,
         canEditNow },
  wallet: { currency, availableBalancePaise, reservedBalancePaise },
  serverNow }
```

`bet.id` is the bet's own handle (consistent with the wallet DTOs' `id`); the user-facing
reference is `publicRef`. Never serialized: `clientRequestId`, the ledger idempotency key,
`marketId` / `marketRoundId` / `userId` / `walletId`, any admin field. `canEditNow` is
`getBettingWindow(...).canEditBet` — `false` for a bet placed in `CLOSING_SOON`.

### Route

`POST /api/bets` — `export const dynamic = "force-dynamic"`; `isTrustedOrigin` (same-origin
CSRF guard, matching the auth / quote / mock-deposit mutations) -> `requirePlayer()` (ACTIVE
PLAYER; ADMIN -> `403 FORBIDDEN`, anonymous -> `401 UNAUTHENTICATED`, disabled/stale session ->
rejected by `findActiveSessionUser`) -> `placeBetRequestSchema.parse` (Zod failure ->
`400 INVALID_INPUT`) -> `placeBet` -> `{ data: BetPlacementReceipt }`. No `userId` from the
client — the bet owner is the authenticated session.

## Window 4A4: bet editing, revisions, player bet reads

Backend / financial domain only. Whole-wager editing of an ACTIVE bet before its round's edit
cutoff, one immutable `betRevisions` row per edit, a wallet movement for the STAKE DIFFERENCE
only, and the owner-only player bet **read** backend (`GET /api/bets`, `GET /api/bets/:id`).
**No My Bets / ticket / edit UI, no PNG/PDF, no withdrawal workflow, no admin CRUD, no result
declaration, no settlement, no payout credit, no visual redesign.** Window 2A's visual design
remains pending a dedicated Codex visual-browser refinement pass; this window built no UI. The
roadmap lists "My Bets" under Window 5 — only its read backend is built here (no UI); the
Window 5 UI and the edit screen both consume it, and Window 4A3's handoff already earmarked
`GET /api/bets` / `GET /api/bets/:id` as immediately next.

### Module layout

```text
lib/errors/domain-error.ts                 # + BET_NOT_FOUND (404), STALE_VERSION (409)
modules/betting/
  models/
    bet.model.ts                           # + BetRow lean-read type (no schema/index change)
    bet-revision.model.ts                  # + BetRevisionRecord / BetRevisionDoc / BetRevisionRow types (no schema/index change)
  validators/
    bet-query.ts                           # betsListQuerySchema (.strict): limit 1-50 default 20, cursor, status?, market?
    edit-bet-input.ts                      # editBetRequestSchema (Zod discriminated union on entryMethod, each branch .strict()),
                                           #   toEditEntryInput - same method-input field names as quote/placement,
                                           #   + expectedVersion + editRequestId, NO marketSlug
  services/
    bet-read.service.ts                    # listPlayerBets, getPlayerBetDetail, resolveOwnedBet, ownedBetFilter,
                                           #   toPlayerBetDTO / toBetRevisionDTO / entryMetadataOf, bet cursor codec (server-only)
    bet-edit.service.ts                    # editBet(input, options?) -> PlayerBetDetailDTO; betEditWalletKey;
                                           #   compositionMatchesNormalized (server-only)
src/app/api/bets/route.ts                  # + GET (ACTIVE PLAYER) alongside the existing POST
src/app/api/bets/[id]/route.ts             # GET + PATCH (ACTIVE PLAYER; PATCH same-origin; force-dynamic)
```

`lib/dates/market-time.ts`, `modules/markets/*`, `modules/settings/*` and
`modules/wallet/services/wallet.service.ts` are consumed unchanged - the edit reuses
`normalizeBetEntry`, `getBettingWindow`, `roundStateOf`, `getPlatformSettings` and the
`debitAvailableInSession` / `creditAvailableInSession` primitives verbatim. The wallet still
never imports betting (`Bet -> Wallet`, `referenceType: "BET"` / `referenceId` the generic link).

### Layering

```text
API (thin route)  ->  Zod (editBetRequestSchema / betsListQuerySchema)  ->  BetEditService.editBet / BetReadService.*
      |
shared normalization engine (normalizeBetEntry) . market/round models (Window 3A) .
platform settings (minimum stake only) . wallet transaction primitives (BET_EDIT_DEBIT / BET_EDIT_REFUND)
      |
one Mongo transaction (withTransaction): wallet delta + ledger + CAS Bet update + betRevisions insert
```

### `editBet(input, options?)`

`input = { userId, betRef, request }` where `betRef` is the bet's `id` handle (24-hex) or its
`publicRef`. `options` is a test seam only - `{ clock?, afterWalletMovement? }`, production
passes neither.

1. **Read settings, normalize.** `getPlatformSettings()` for `minimumStakePaise` **only** - the
   payout multiplier is never read here (rule 4). `normalizeBetEntry(toEditEntryInput(request),
   request.stakePaise, minimumStakePaise)` - the shared pure engine, fail-fast
   (`INVALID_SELECTION` / `STAKE_BELOW_MINIMUM` / `MONEY_OUT_OF_RANGE`) with no database round-trip.
2. **Resolve the caller's own bet** - `resolveOwnedBet(userId, betRef)`; missing or non-owned is
   `BET_NOT_FOUND` (404).
3. **Idempotent-replay recovery FIRST** - `BetRevision.findOne({ userId, editRequestId })`. If a
   revision exists for this id, its `after` snapshot equals the newly-normalized wager and its
   `betId` matches, return `getPlayerBetDetail(...)` **without** re-checking the cutoff and
   **without** a wallet movement - a replay after cutoff still returns the previous success. A
   different target wager (or a different bet) is `DUPLICATE_REQUEST`.
4. **Guards** - `status === "ACTIVE"` (`BET_ALREADY_SETTLED`), `version === expectedVersion`
   (`STALE_VERSION`), then `getBettingWindow(market.enabled, roundStateOf(round), clock())
   .canEditBet` for the bet's **own** round (a closed round is not editable) - a blocked reason
   maps to its verbatim code (`EDIT_WINDOW_CLOSED` / `MARKET_CLOSED` / `MARKET_DISABLED` / ...).
5. **Validate the post-edit composition** - build a throwaway `new Bet({...})` and a
   `new BetRevision({...})` and `.validate()` both, so the schema `pre("validate")` invariants
   (count = selections length, total = sum of stakes, metadata <-> method, `toVersion =
   fromVersion + 1`, `walletDeltaPaise = before.total - after.total`) run before the native
   writes that bypass hooks.
6. **One `withTransaction`:**
   - fresh `now = clock()`; re-read the bet + market + round **in the session**; re-check
     `status` / `version === expectedVersion` / `getBettingWindow(...).canEditBet` against
     `now` - the authoritative cutoff check at the transactional boundary (rule 10);
   - `stakeDelta = after.totalStakePaise - before.totalStakePaise`. `> 0` ->
     `debitAvailableInSession({ type: "BET_EDIT_DEBIT", amountPaise: stakeDelta, idempotencyKey:
     BET_EDIT_DEBIT:<betId>:v<toVersion> })`; `< 0` -> `creditAvailableInSession({ type:
     "BET_EDIT_REFUND", amountPaise: -stakeDelta, idempotencyKey: BET_EDIT_REFUND:<betId>:v<toVersion> })`;
     `= 0` -> no movement. The difference only - never a full refund + re-debit (rule 6);
   - `options.afterWalletMovement?.()` (test seam to force a post-movement rollback);
   - **CAS** `Bet.collection.updateOne({ _id, userId, version: expectedVersion, status:
     "ACTIVE" }, { $set: { ...composition..., version: toVersion, lastEditedAt: now, updatedAt: now } })`
     - the `(version, status)` filter is the atomic optimistic lock; `matchedCount !== 1` =>
     `STALE_VERSION`. Native driver, matching the placement service's reason (a Mongoose doc
     created in a `connection.transaction()` session is reset on retry and resetting its
     `strict:"throw"` `entryMetadata` sub-document throws);
   - `BetRevision.collection.insertOne(revObj, { session })` - the unique `(betId, toVersion)`
     and `(userId, editRequestId)` indexes are the real backstop.
7. **After commit** return `getPlayerBetDetail(userId, betId, at)` - the DTO is rebuilt from
   persisted state and includes the new `revisions[]`.
8. **Duplicate-key recovery** outside the aborted transaction: a collision on `(userId,
   editRequestId)` for the *same* target wager replays the winner; a `(betId, toVersion)`
   collision from a different racing edit means that edit won -> `STALE_VERSION`; a same-id /
   different-wager collision is `DUPLICATE_REQUEST`.

### Player bet reads

`listPlayerBets(userId, { limit, cursor, status?, market? }, now)` - `userId` from the session
only. Newest first, stable `createdAt` desc then `_id` desc, opaque base64url cursor over the
last row's `(createdAt, _id)` (identical scheme to `GET /api/wallet/transactions`), always
bounded (`limit` clamped to `[1, 50]`, default 20). The page's markets and rounds are
batch-loaded with two `$in` reads, never one query per bet. `getPlayerBetDetail(userId,
idOrRef, now)` adds the full `revisions[]` (oldest first) for the ticket / edit screen.
`ownedBetFilter` matches a 24-hex `idOrRef` as `_id` and anything else as an upper-cased
`publicRef`, always AND-ed with `userId`.

### DTOs

`PlayerBetDTO` = `{ id, publicRef, market: {name, slug, code}, businessDate, entryMethod,
entryMetadata, selections: [{number, stakePaise}], totalSelections, totalStakePaise,
payoutMultiplierSnapshot, status, version, placedAt, lastEditedAt, editCutoffAt, closesAt,
canEditNow, result, winningNumber, payoutPaise, settledAt }`. `PlayerBetDetailDTO` adds
`revisions: BetRevisionDTO[]`. `BetRevisionDTO` = `{ fromVersion, toVersion, before, after,
walletDeltaPaise, editedAt }` where `before` / `after` = `{ entryMethod, entryMetadata,
selections, totalStakePaise }`. Never serialized: `userId`, `marketId`, `marketRoundId`,
`clientRequestId`, `betId`, `editRequestId`, the ledger idempotency key, any Mongo `_id` on a
sub-document. `winningNumber` / `payoutPaise` / `settledAt` are `null` (no settlement engine
yet) - never fabricated.

### Errors

Added stable codes `BET_NOT_FOUND` (404) and `STALE_VERSION` (409) to
`lib/errors/domain-error.ts`. `EDIT_WINDOW_CLOSED` (422), `MARKET_CLOSED` / `MARKET_DISABLED` /
`MARKET_NOT_OPEN` / `ROUND_NOT_FOUND` (422/404), `BET_ALREADY_SETTLED` (409),
`INSUFFICIENT_BALANCE` (422), `DUPLICATE_REQUEST` (409), `INVALID_SELECTION` /
`STAKE_BELOW_MINIMUM` / `MONEY_OUT_OF_RANGE` (422), `INVALID_INPUT` (400) already existed and
are reused verbatim - no synonymous codes.

### Routes

`GET /api/bets` - `requirePlayer()` -> `betsListQuerySchema.parse` -> `listPlayerBets` ->
`{ data: { bets, nextCursor, serverNow } }`. `GET /api/bets/[id]` - `requirePlayer()` ->
`getPlayerBetDetail` -> `{ data: { bet, serverNow } }`. `PATCH /api/bets/[id]` - `isTrustedOrigin`
(same-origin, `403` on mismatch) -> `requirePlayer()` -> `editBetRequestSchema.parse` -> `editBet`
-> `{ data: { bet, serverNow } }`. All `export const dynamic = "force-dynamic"`; an ADMIN
session is `403 FORBIDDEN`, anonymous `401 UNAUTHENTICATED`; no `userId` is accepted from the
client on any of them.

## Window 5A: player withdrawal lifecycle

Backend / financial domain only. The player withdrawal lifecycle — request, own list / detail,
player cancellation while PENDING — plus the transaction-scoped **admin approve / reject
primitives** that Window 6A will route. **No withdrawal UI, no admin withdrawal routes, no admin
dashboard, no real payout / Razorpay / bank / UPI integration, no settlement, no visual
redesign.** Window 2A's visual design remains pending a dedicated Codex pass; this window built
no UI.

### Module layout

```text
lib/errors/domain-error.ts                     # + WITHDRAWAL_NOT_FOUND (404); WITHDRAWAL_NOT_PENDING (409) already existed
modules/withdrawals/
  models/
    withdrawal.model.ts                        # + destinationSummary (safe, required, immutable),
                                               #   bounded paymentDetails strings, immutable request fields,
                                               #   WithdrawalRecord / WithdrawalDoc / WithdrawalRow types.
                                               #   Existing indexes unchanged: (userId, createdAt desc),
                                               #   (status, requestedAt), UNIQUE (userId, clientRequestId).
  validators/
    withdrawal-input.ts                        # createWithdrawalSchema (Zod discriminated union on method,
                                               #   each branch .strict()); BANK carries confirmAccountNumber
                                               #   (equality-checked, never stored); toPaymentDetails,
                                               #   buildDestinationSummary; withdrawalsListQuerySchema; cancelWithdrawalSchema
  services/
    withdrawal.service.ts                      # requestWithdrawal, listPlayerWithdrawals, getPlayerWithdrawalDetail,
                                               #   resolveOwnedWithdrawal, cancelWithdrawal; approveWithdrawalByAdmin /
                                               #   rejectWithdrawalByAdmin (FUTURE ADMIN - not routed); toWithdrawalDTO,
                                               #   assertWithdrawalAmount, withdrawal cursor codec, ledger-key builders (server-only)
src/app/api/withdrawals/route.ts               # GET (own list) + POST (create) - ACTIVE PLAYER; POST same-origin; force-dynamic
src/app/api/withdrawals/[id]/route.ts          # GET (own detail) - ACTIVE PLAYER; force-dynamic
src/app/api/withdrawals/[id]/cancel/route.ts   # POST (cancel own PENDING) - ACTIVE PLAYER; same-origin; force-dynamic
```

`modules/wallet/services/wallet.service.ts` is consumed unchanged - the withdrawal service
reuses `reserveInSession` (`WITHDRAWAL_RESERVED`), `releaseReservedInSession`
(`WITHDRAWAL_RELEASED`), `finalizeReservedInSession` (`WITHDRAWAL_APPROVED`), `createPlayerWallet`
and `getWalletView` verbatim. The wallet never imports withdrawals (`Withdrawal -> Wallet`,
`referenceType: "WITHDRAWAL"` / `referenceId` the generic link).

### Layering

```text
API (thin route)  ->  Zod (createWithdrawalSchema / withdrawalsListQuerySchema)  ->  WithdrawalService.*
      |
wallet transaction primitives (reserve / release / finalize, Window 4A2)
      |
one Mongo transaction (withTransaction): wallet delta + ledger row + native withdrawal insert / CAS status update
```

### `requestWithdrawal(input, options?)`

`input = { userId, request }` (`request` already parsed by `createWithdrawalSchema`). `options`
is a test seam only - `{ clock?, afterWalletMovement? }`.

1. **Validate the amount** - `assertWithdrawalAmount` (`INVALID_AMOUNT` below Rs 1,
   `MONEY_OUT_OF_RANGE` beyond safe-integer precision). Derive `destinationSummary` (masked) and
   `paymentDetails` (the duplicated `confirmAccountNumber` is dropped).
2. **Existing-success idempotency recovery FIRST** - `Withdrawal.findOne({ userId, clientRequestId })`.
   A hit whose `(method, amountPaise, destinationSummary)` matches returns the ORIGINAL
   withdrawal with no second reserve / ledger row; a conflicting payload is `DUPLICATE_REQUEST`.
3. **Ensure a Rs 0 wallet** (`createPlayerWallet` - never grants funds), pre-allocate the
   withdrawal `_id`, build + `.validate()` a throwaway `new Withdrawal({...})` so the schema
   `pre("validate")` invariants (method <-> paymentDetails shape) run before the native insert.
4. **One `withTransaction`:** `reserveInSession({ amountPaise, idempotencyKey:
   WITHDRAWAL_RESERVED:<withdrawalId>, referenceType: "WITHDRAWAL", referenceId })` - fails
   `INSUFFICIENT_BALANCE` when `available < amount` (this IS the "maximum = available balance"
   rule) -> native `Withdrawal.collection.insertOne` of the `PENDING` document. The reserve
   precedes the insert so an insert failure demonstrably rolls the wallet back. A native insert
   is used for the same reason as bet placement - a Mongoose doc created inside
   `connection.transaction()` is reset on retry, and resetting its `strict:"throw"`
   `paymentDetails` sub-document throws.
5. **Lost `(userId, clientRequestId)` race** - the loser's insert collides on the unique index
   inside its aborted transaction (reserve included); recover the winner outside it.

### Terminal transitions - `cancelWithdrawal` / `approveWithdrawalByAdmin` / `rejectWithdrawalByAdmin`

All three share `applyTerminalTransition`: one `withTransaction` that re-reads the withdrawal
**in-session**, moves the wallet through a Window 4A2 primitive, then flips the status with a
compare-and-set `Withdrawal.collection.updateOne({ _id, status: "PENDING" }, { $set: { status,
decidedAt, ... } })`. `matchedCount !== 1` (a concurrent transition already won) throws
`WITHDRAWAL_NOT_PENDING`, which aborts the whole transaction - the wallet movement rolls back
with it. An in-session read already showing the target status means an identical racing
transition committed first: return without moving money again. After a lost race the caller
re-reads and returns success **only when the withdrawal actually reached the target state**; a
forced-rollback failure leaves it PENDING and rethrows.

| Transition | Who | Guard -> new status | Wallet move | Ledger key | Notes |
| --- | --- | --- | --- | --- | --- |
| cancel | player, own | `PENDING -> CANCELLED` | `releaseReservedInSession` (`available += X`, `reserved -= X`) | `WITHDRAWAL_RELEASED:<id>` | already-CANCELLED -> DTO, no re-release; APPROVED/REJECTED -> `WITHDRAWAL_NOT_PENDING` (409); not deleted |
| reject | future admin (primitive, **not routed**) | `PENDING -> REJECTED` + reason | `releaseReservedInSession` | `WITHDRAWAL_RELEASED:<id>` | reason required (`INVALID_INPUT` if blank); already-REJECTED -> DTO |
| approve | future admin (primitive, **not routed**) | `PENDING -> APPROVED` | `finalizeReservedInSession` (`reserved -= X` only) | `WITHDRAWAL_APPROVED:<id>` | available unchanged; no real payout; already-APPROVED -> DTO |

cancel and reject share `WITHDRAWAL_RELEASED:<id>` - safe because a withdrawal has exactly one
terminal transition (the CAS on `status: "PENDING"`), so only one can ever win, and the shared
unique ledger key is an extra double-release guard.

### DTO / masking

`toWithdrawalDTO` returns `{ id, method, amountPaise, status, destination: { method, summary },
rejectionReason, requestedAt, decidedAt, cancelledAt, approvedAt, rejectedAt, createdAt,
updatedAt }`. `summary` is the stored pre-masked `destinationSummary`; `paymentDetails` is
**never** read on any player path. The schema's single generic `decidedAt` is mapped onto the
status-specific `cancelledAt` / `approvedAt` / `rejectedAt` (and still returned raw). Never
serialised: `userId`, `paymentDetails`, `clientRequestId`, `decidedByAdminId`, the ledger
idempotency key, sub-document `_id`.

### Errors

Added `WITHDRAWAL_NOT_FOUND` (404) to `lib/errors/domain-error.ts`. `WITHDRAWAL_NOT_PENDING`
(409), `INSUFFICIENT_BALANCE` (422), `INVALID_AMOUNT` (422), `MONEY_OUT_OF_RANGE` (422),
`DUPLICATE_REQUEST` (409), `FORBIDDEN` (403), `UNAUTHENTICATED` (401), `INVALID_INPUT` (400)
already existed and are reused verbatim - no synonymous codes.

### Routes

`GET /api/withdrawals` - `requirePlayer()` -> `withdrawalsListQuerySchema.parse` ->
`listPlayerWithdrawals` -> `{ data: { withdrawals, nextCursor, serverNow } }`.
`GET /api/withdrawals/[id]` - `requirePlayer()` -> `getPlayerWithdrawalDetail` ->
`{ data: { withdrawal, serverNow } }`. `POST /api/withdrawals` and
`POST /api/withdrawals/[id]/cancel` - `isTrustedOrigin` (same-origin, `403` on mismatch) ->
`requirePlayer()` -> Zod -> service -> `{ data: { withdrawal, wallet, serverNow } }`. All
`export const dynamic = "force-dynamic"`; an ADMIN session is `403 FORBIDDEN`, anonymous
`401 UNAUTHENTICATED`; no `userId` is accepted from the client. A non-owned or missing
withdrawal is an indistinguishable `404 WITHDRAWAL_NOT_FOUND` on detail and cancel.

## Window 6A1: admin player management, manual wallet movement, DB provisioning & demo seed

Backend / financial domain only — **no admin UI**. Adds the first `/api/admin/*` surface, the
first `auditLogs` writer, and two operational CLIs. See DOMAIN_RULES.md's "Window 6A1
implementation clarification" for the frozen-rule mapping, API_CONTRACTS.md's "Window 6A1 -
implemented admin player & wallet contract" for exact shapes, and DATABASE.md's Window 6A1
section for the one additive schema field.

### Module layout

```
src/modules/admin/
  validators/admin-player-input.ts   strict Zod for every admin route
  services/
    admin-player.service.ts          create / list / detail / disable / enable /
                                     reset-password / wallet view / linked bet & withdrawal reads
    admin-wallet.service.ts          adminCreditWallet / adminDebitWallet / admin ledger read
    player-deletion.service.ts       playerDeletionService.purgePlayer() (implements the
                                     Window 6 PlayerDeletionService contract) + purgePlayerById
src/modules/audit/services/
  audit-log.service.ts               writeAuditLog(...) — the single auditLogs writer + redaction
src/app/api/admin/players/           10 route files (thin handlers)
scripts/provision-db.ts              npm run db:provision
scripts/seed-demo.ts                 npm run db:seed-demo
```

### Layering

Handlers stay thin: `requireAdmin()` → (mutations) `isTrustedOrigin` → strict Zod → service →
sanitized `{ data }`. Services own all business logic, transactions and authorization nuance.
The wallet is touched ONLY through the Window 4A2 core (`applyWalletMovement` and the named
wrappers) — no admin code writes a balance directly (CODEX_RULES #10). `auditLogs` is written
ONLY through `writeAuditLog`.

### `resolvePlayer` — the admin authorization primitive

Every player-targeting service call goes through `resolvePlayer(playerId, session?)`: 24-hex
check → `User.findOne({ _id, role: "PLAYER" })`. A missing id, a malformed id and an **ADMIN**
id are all an indistinguishable `PLAYER_NOT_FOUND` (404), so admin accounts cannot be
enumerated or mutated through player management (brief §29). `passwordHash` is `select:false`
and never loaded anywhere in the module.

### Admin player lifecycle

- **create** — one transaction: `User.create` (role server-forced PLAYER, `createdBy` = admin) →
  `createPlayerWallet` (₹0) → `writeAuditLog(PLAYER_CREATED)`. Pre-checks give clean
  `LOGIN_ID_TAKEN` / `IDENTIFIER_TAKEN`; the unique `users` indexes are the race backstop
  (E11000 re-mapped to the same codes).
- **list** — `role: "PLAYER"`, newest-first `(createdAt, _id)` cursor, `search` on normalized
  `loginId` / `email` (case-insensitive substring) + exact `phone`. Wallet balances and
  bet / withdrawal counts are batch-loaded (one `$in` wallet read + two `$group` aggregates) —
  never one query per row.
- **disable / enable** — CAS `updateOne` on `{ role:"PLAYER", status:<from> }` inside a
  transaction; disable also `revokeAllUserSessions(userId, session)`. Audit only on a real
  transition (idempotent repeat writes nothing). Enable never recreates sessions.
- **reset-password** — `hashPassword` → `updateOne` `passwordHash` + `passwordChangedAt` →
  `revokeAllUserSessions` → `writeAuditLog(PLAYER_PASSWORD_RESET)` (no password material), one
  transaction. Never returns the hash. Not a player self-service flow.
- **linked reads** — `listPlayerBetsForAdmin` / `listPlayerWithdrawalsForAdmin` reuse the exact
  player-facing `listPlayerBets` / `listPlayerWithdrawals` (already-sanitized DTOs) after
  `resolvePlayer`. Admin inspects bets / revisions only — there is no admin bet or ledger edit
  path anywhere (brief §23).

### Manual wallet movement (`admin-wallet.service.ts`)

`adminCreditWallet` / `adminDebitWallet` share one `adjust(type, input, options)` core:

1. `resolvePlayer` (PLAYER only), `assertAdminAdjustmentAmount` (≥ ₹1, safe integer), require a
   non-empty `reason`.
2. `createPlayerWallet` (₹0 ensure), build key
   `ADMIN_WALLET_ADJUSTMENT:<adminId>:<clientRequestId>` — **operation-agnostic** so a
   credit↔debit reuse of a request id collides in the wallet core's `assertSameOperation`.
3. existing-success recovery FIRST (`getTransactionByIdempotencyKey`): an exact match replays
   the original receipt; a mismatch on type / amount / player / `adminReason` /
   `adminPaymentReference` is `DUPLICATE_REQUEST`.
4. one `withTransaction`: `applyWalletMovement` (writes the immutable `ADMIN_CREDIT` /
   `ADMIN_DEBIT` ledger row carrying `adminReason` + `adminPaymentReference` +
   `createdByAdminId`) → `writeAuditLog(ADMIN_WALLET_CREDIT / ADMIN_WALLET_DEBIT)` — **skipped
   on the in-transaction idempotent-replay path** so a write-conflict retry never double-audits
   a single adjustment.
5. a lost race collides on the unique `idempotencyKey` index inside the aborted transaction and
   is recovered outside it.

`ADMIN_DEBIT` uses the wallet core's `availableBalancePaise >= amount` guard, so available never
goes negative (`INSUFFICIENT_BALANCE`) and `reservedBalancePaise` is never read or written. The
resulting balance always comes from `applyWalletMovement`, never the request. An
`afterWalletMovement` test seam forces a post-movement / pre-commit rollback.

`listPlayerWalletTransactionsForAdmin` returns `AdminWalletTransactionDTO` — the player ledger
fields plus `reason` / `paymentReference` / `actorAdminId`, but never the `idempotencyKey`.

### Hard purge (`player-deletion.service.ts`)

`playerDeletionService.purgePlayer({ actorAdminId, playerId })` — the single deletion boundary
(ADMIN_SPEC.md). One `withTransaction`: collect the player's `bet` ids → delete `betRevisions`
(by `userId` or `betId`), `bets`, `withdrawals`, `walletTransactions`, `wallets`, `sessions`,
`otpRequests`, every `auditLogs` row with `subjectUserId` **or** `entityId` = the player, then
CAS-delete the `user` on `{ role: "PLAYER" }`. Finally `writeAuditLog(PLAYER_DELETION_COMPLETED)`
with `entityType: "Player"` and **no** `entityId` / `subjectUserId` / snapshot. ADMIN targets
are `PLAYER_NOT_FOUND`. No tombstone, no deny-list — the freed `loginId` is immediately
reusable for a new account.

### Audit (`audit-log.service.ts`)

`writeAuditLog(input, session?)` is the only `auditLogs` writer. It deep-copies `before` /
`after` replacing any `password` / `passwordHash` / `newPassword` / `token` / `codeHash` /
`secret`-style key (case-insensitive, any depth) with `[REDACTED]`, and requires `subjectUserId`
on every player-associated row so `purgePlayer` can find it. Actions:
`PLAYER_CREATED` · `PLAYER_DISABLED` · `PLAYER_ENABLED` · `PLAYER_PASSWORD_RESET` ·
`PLAYER_DELETION_COMPLETED` · `ADMIN_WALLET_CREDIT` · `ADMIN_WALLET_DEBIT`.

### Errors

Added `PLAYER_NOT_FOUND` (404), `LOGIN_ID_TAKEN` (409), `IDENTIFIER_TAKEN` (409) to
`lib/errors/domain-error.ts`. `INVALID_AMOUNT` (422), `INSUFFICIENT_BALANCE` (422),
`MONEY_OUT_OF_RANGE` (422), `DUPLICATE_REQUEST` (409), `INVALID_INPUT` (400), `FORBIDDEN` (403),
`UNAUTHENTICATED` (401) are reused verbatim — no synonymous codes.

### Reuse of the wallet core

`WalletMovementInput` / `NamedMovementInput` gained optional `adminReason` /
`adminPaymentReference`; `applyWalletMovement` persists them on the ledger row and
`assertSameOperation` compares them (a replayed key with a materially different reason /
reference is `DUPLICATE_REQUEST`). `revokeAllUserSessions` gained an optional `session` param so
disable / reset / purge revoke sessions inside their transaction. Nothing else in the wallet or
auth core changed.

### Operational CLIs

- **`scripts/provision-db.ts`** (`db:provision`) — connect → `createCollection` for any missing
  canonical collection (swallow `NamespaceExists`) → `ensureIndexes()` (additive `createIndexes`,
  never `syncIndexes`) → `seedFoundation()` (`$setOnInsert` upserts). Non-destructive,
  idempotent, cross-checks the model registry against the frozen 12-name list, prints names /
  index counts only.
- **`scripts/seed-demo.ts`** (`db:seed-demo`) — guarded by `DEMO_SEED_ENABLED=true`
  (`getDemoSeedEnv`); passwords come from the environment, never source. Pre-flight role-conflict
  scan aborts with no writes. Creates `test1` (PLAYER) + `doni` / `pankaj` / `gopal` (ADMIN),
  hashed. The demo player's ₹10,000 opening balance is a keyed `ADMIN_CREDIT` through
  `applyWalletMovement` (key `ADMIN_CREDIT:DEMO_OPENING_BALANCE:test1:v1`), never a direct write.
  Deterministic and idempotent — a rerun preserves accounts and never re-credits.

### Routes

10 files under `src/app/api/admin/players/`, all `apiRoute` + `export const dynamic =
"force-dynamic"` + `requireAdmin()`; every mutation also `isTrustedOrigin` (`403` on mismatch).
`GET|POST /players`, `GET|DELETE /players/[id]`, `POST /players/[id]/status`,
`POST /players/[id]/reset-password`, `GET /players/[id]/wallet`,
`GET /players/[id]/wallet/transactions`, `POST /players/[id]/wallet/credit`,
`POST /players/[id]/wallet/debit`, `GET /players/[id]/bets`, `GET /players/[id]/withdrawals`.
Anonymous → `401`, PLAYER → `403`. No admin id / role is read from the request.
