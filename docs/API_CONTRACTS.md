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
