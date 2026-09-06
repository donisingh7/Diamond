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
