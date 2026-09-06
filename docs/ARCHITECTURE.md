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
