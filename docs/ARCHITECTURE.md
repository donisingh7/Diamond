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
| `modules/withdrawals` | Withdrawal persistence; reservation/decision/cancellation services remain Window 5/6. |
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
