# Frozen domain rules

Read [CODEX_RULES.md](CODEX_RULES.md) first. These requirements are authoritative and originate from the approved Window 1 brief. DOMAIN_RULES.md owns business rules; the roadmap limits implementation scope. Future-facing descriptions do not imply implemented features.

## FROZEN PRODUCT RULES

Document these accurately in `DOMAIN_RULES.md`.

## Currency

Prototype currency:

```text
INR
```

Internally monetary calculations should use the smallest currency unit:

```text
₹1 = 100 paise
```

Never use JavaScript floating point arithmetic as the authoritative money representation.

## MARKETS

Seed these markets.

### Shree Ganesh

```text
Open: 07:00 AM IST
Close: 04:40 PM IST
```

### Delhi Bazar

```text
Open: 07:00 AM IST
Close: 03:00 PM IST
```

### Faridabad

```text
Open: 07:00 AM IST
Close: 05:50 PM IST
```

### Ghaziabad

```text
Open: 07:00 AM IST
Close: 09:00 PM IST
```

### Gali

```text
Open: 07:00 AM IST
Close: 11:10 PM IST
```

### Disawar

```text
Open: 07:00 AM IST
Close: 03:00 AM IST on the NEXT calendar day
```

All markets use:

```text
timezone = Asia/Kolkata
```

All markets currently use:

```text
editLockMinutesBeforeClose = 60
```

Do NOT hardcode these timings in UI code.

They must originate from persisted/configured market data.

## MARKET ROUND MODEL

A market is permanent.

A market round is daily.

Example:

```text
Faridabad
  ├── 2026-09-06 round
  ├── 2026-09-07 round
  └── ...
```

A round must persist:

* business date
* actual `opensAt`
* actual `editCutoffAt`
* actual `closesAt`
* result
* result declaration information
* settlement state
* settlement summary

For Disawar:

```text
businessDate: September 6
opensAt: September 6 07:00 IST
closesAt: September 7 03:00 IST
```

It still belongs to the September 6 business round.

Centralize this logic.

Do not reimplement cross-midnight calculations separately in UI, admin, settlement, etc.

## MARKET STATUS

Do NOT depend on a mutable persisted `OPEN/CLOSED` field that needs a cron update every minute.

Market/round status should be derived from:

* market enabled state
* current server time
* opensAt
* closesAt
* result presence
* settlement state

Conceptual states include:

```text
UPCOMING
OPEN
CLOSING_SOON
CLOSED / RESULT_PENDING
RESULT_DECLARED
SETTLED
DISABLED
```

Exact presentation state may be derived later, but server timing is authoritative.

### Window 3A implementation clarification (no business rule changed)

The frozen rules above are implemented, not altered:

- **Boundary equality.** New bets are allowed on `[opensAt, closesAt)` — at exactly `closesAt` the market is closed for new bets. Bet editing is allowed while `now < editCutoffAt` — at exactly `editCutoffAt` editing is locked while new bets continue until close. `editCutoffAt = closesAt − editLockMinutesBeforeClose` (60 min for all current markets).
- **`CLOSING_SOON`** is the edit-locked interval `[editCutoffAt, closesAt)` — a presentation label over the same timings, never a new placement cutoff. `deriveMarketStatus` returns it; `getBettingWindow` still reports `canPlaceBet: true` there.
- **Disawar current round.** Between 00:00 and 02:59:59 IST the *current* round is still the previous calendar date's (it owns every instant in `[opensAt, closesAt)`). From 03:00 to 06:59:59 IST the current round is the new calendar date's `UPCOMING` round; the just-closed round is not "current" but remains queryable by `(marketId, businessDate)` for results/settlement. This is a round-selection convention, not loss of history.
- **Round time snapshots.** A round persists `opensAt`/`editCutoffAt`/`closesAt` computed from the market's schedule *at creation*; a later admin schedule edit changes only future rounds.
- **Results are read-only here.** Result strings stay `"00"`–`"99"` (2-char, leading zero preserved). No result declaration or settlement was implemented; historical results derive from `marketRounds`, not a separate collection.

## BETTING MODEL

There are currently three ways to **construct the same underlying 2-digit bet**:

```text
JODI
CROSSING
COPY_PASTE
```

These are NOT three unrelated settlement systems.

They normalize to:

```text
selection number + stake
```

Example:

```text
22 → ₹10
48 → ₹10
91 → ₹10
```

The settlement engine must only need the normalized selections.

## JODI RULES

Numbers range:

```text
00–99
```

Number values must be stored as 2-character strings.

Examples:

```text
"00"
"07"
"48"
"99"
```

Never convert `"07"` to integer `7`.

Player selects multiple numbers.

One common amount applies to all selected numbers.

Example:

```text
22
48
91

₹10 each

total = ₹30
```

## CROSSING RULES

Crossing receives digits.

Example:

```text
428935
```

Normalize to unique input digits:

```text
4,2,8,9,3,5
```

Generate Cartesian combinations:

```text
44
42
48
49
43
45

24
22
28
...
```

For 6 unique digits:

```text
6 × 6 = 36 selections
```

At ₹20 per selection:

```text
₹720 total
```

Duplicate input digits must be removed before generating combinations.

Example:

```text
4428
```

normalizes to:

```text
4,2,8
```

and produces:

```text
3 × 3 = 9 selections
```

Do NOT intentionally duplicate selections.

## COPY PASTE RULES

Player may paste sequences such as:

```text
2215489635
```

which should parse into:

```text
22
15
48
96
35
```

Also plan parser support for common separators such as:

```text
22,15,48,96,35
22 15 48 96 35
22.15.48.96.35
```

Invalid odd/incomplete inputs should later produce clear validation errors rather than silently inventing digits.

### Without Palti

Input:

```text
22,15,48,96,35
```

Selections:

```text
22
15
48
96
35
```

### With Palti

For every 2-digit number, include its reverse.

Example:

```text
15 → 51
48 → 84
96 → 69
35 → 53
22 → 22
```

Final unique set:

```text
22
15
51
48
84
96
69
35
53
```

Duplicates are removed.

## STAKE / PAYOUT

Minimum stake per selection:

```text
₹1
```

No configured maximum stake for prototype.

A bet still cannot exceed available wallet balance.

Current payout multiplier:

```text
90x
```

Examples:

```text
₹1 stake → ₹90 final winning credit
₹10 stake → ₹900 final winning credit
₹100 stake → ₹9,000 final winning credit
```

This is the complete credit amount.

Do NOT add the original stake again.

Crossing and Copy Paste ultimately generate the same 2-digit selections and use the same 90x payout.

Do not hardcode `90` inside settlement logic.

The current payout multiplier comes from platform/game configuration.

When a bet is created, persist:

```text
payoutMultiplierSnapshot = 90
```

Existing bets keep their stored payout multiplier even if admin later changes the current rate.

### Window 4A1 implementation clarification (no business rule changed)

The frozen rules above (JODI / CROSSING / COPY PASTE / Palti / stake / 90x payout) are implemented as pure engines plus a read-only quote. Nothing was altered.

- **Canonical selection.** Every entry method normalizes to `{ number: "00"–"99" (two-character string), stakePaise: integer }`. Numbers are never stored as integers; leading zeros survive every transformation. Engine output is deterministic and de-duplicated.
- **Duplicate handling.** Duplicates arriving through input (a JODI list, a Copy Paste sequence, repeated Crossing digits) **collapse** to a single canonical selection — first occurrence kept, order preserved — rather than being charged twice. No frozen document requires rejection and the API Zod layer does not enforce uniqueness, so the engine is the safe normalization point.
- **Crossing ordering.** Deduplicate source digits in first-appearance order, then emit the full ordered Cartesian product (outer loop = first digit, inner loop = second digit, same order), self-pairs included. For `428`: `44 42 48 24 22 28 84 82 88`. `n` unique digits → exactly `n²` selections; inherently ≤ 100 (at most 10 distinct digits).
- **Copy Paste parsing.** Accepts one contiguous even-length digit run, or numbers separated by spaces / commas / dots (mixed runs of those tolerated). No other punctuation is a separator. Fail-closed: any token that is not exactly two digits rejects the whole input — no digit is invented, dropped or truncated.
- **Palti.** An option inside Copy Paste, not a separate bet type — the canonical method stays `COPY_PASTE` with metadata `palti: true`. Process originals in input order; emit the original, then its reverse if not already emitted; de-duplicate globally; self-palindromes appear once. `22 15 48 96 35` with Palti → `22 15 51 48 84 96 69 35 53`.
- **Stake and payout are configuration-driven.** The minimum stake is `platformSettings.minimumStakePaise` (100) and the multiplier is `platformSettings.payoutMultiplier` (90), both read from the persisted singleton — never a literal. `perWinningSelectionCreditPaise = stakePaise × payoutMultiplier` in integer paise; the stake is not added back. A later window snapshots the multiplier onto each created bet; Window 4A1 persists nothing.
- **Quote is non-binding.** `POST /api/bets/quote` validates and calculates only. It never reads or reserves wallet funds and never writes a bet / wallet / ledger document. It may create the day's operational `MarketRound` (existing Window 3A behaviour). Actual placement (a later window) revalidates market, settings and funds server-side and must not trust a stale client quote.

### Window 4A3 implementation clarification (no business rule changed)

Real player bet placement (`POST /api/bets`). Backend only — no betting/ticket UI. The frozen
rules above (three entry methods normalizing to one selection set, ₹1 minimum stake per
selection, no maximum, a bet cannot exceed available balance, immutable payout snapshot,
`ACTIVE` initial status, one wallet transaction per money movement, `userId + clientRequestId`
idempotency, a human-readable non-ObjectId reference) are implemented, not altered.

- **Nothing trusts a quote.** Placement recomputes `selections`, `entryMetadata`,
  `totalSelections` and `totalStakePaise` from the original entry input through the **same**
  `normalizeBetEntry` engine the quote uses — quote, placement and future editing share one
  wager interpretation. `POST /api/bets` accepts only `marketSlug`, `entryMethod`, the
  method's raw input (`numbers` / `digits` / `rawInput` + `palti`), `stakePaise` and
  `clientRequestId`; every authoritative value (`totalStakePaise`, `selectionCount`,
  `selections`, `payoutMultiplier`, `marketRoundId`, `payout`, `publicRef`, wallet balance) is
  server-derived and a `.strict()` schema rejects any of them in the body.
- **Multiplier snapshot at placement time.** `bet.payoutMultiplierSnapshot` is
  `platformSettings.payoutMultiplier` read from the persisted singleton *inside the placement
  transaction*. A quote taken earlier at 90× is irrelevant; if the admin rate is 95× when the
  bet commits, the snapshot is 95×. A later rate change never rewrites an existing bet's
  snapshot — settlement uses `stake × payoutMultiplierSnapshot` and does not add the stake back.
- **Market re-validation is at the transactional boundary.** The `getBettingWindow`
  gate (`enabled AND round AND now ∈ [opensAt, closesAt) AND result absent AND settlement
  PENDING`) is checked once before the transaction and **again inside it against a fresh server
  clock**, so a retry that lands after the real close cannot create a bet. New placement is
  allowed through the edit-locked `CLOSING_SOON` interval `[editCutoffAt, closesAt)` — at
  exactly `closesAt` placement fails `MARKET_CLOSED`. A bet placed in that interval is valid
  and simply immediately non-editable (`canEditNow: false`); edit cutoff is not bet close.
- **One transaction, no partial success.** `Bet` insert + `availableBalancePaise` debit +
  immutable `BET_PLACED` `walletTransactions` row commit or roll back together. The debit
  filters on `availableBalancePaise >= totalStakePaise` (reserved funds are never spendable),
  so a bet can never drive a balance negative; an insufficient balance, a market-state failure
  or a bet-write failure leaves **no** `bets`, wallet or ledger change. The bet `_id` is
  allocated before the transaction and reused for `Bet._id`, the ledger `referenceId` and the
  deterministic ledger idempotency key `BET_PLACED:<betId>`.
- **`clientRequestId` idempotency.** The frozen unique `(userId, clientRequestId)` index is
  the backstop. A repeat of the *same* logical wager (same market, entry method, canonical
  selections and stake — cosmetic raw-input differences that normalize identically count as
  the same) returns the original bet with no second debit or ledger row, and does so **before**
  the market-close re-check, so a retry at 17:50:01 of a bet placed at 17:49:59 is not
  rejected. The same id reused for a *different* logical wager is `DUPLICATE_REQUEST` (409). Two
  simultaneous identical requests resolve to one bet / one debit / one ledger row — the loser
  collides on the unique index inside its aborted transaction and recovers the winner.
- **Public reference.** `<MARKET CODE>-<MMDD>-<5 random>` e.g. `FB-0906-X7K29`. The random
  suffix is `crypto.randomInt` over a 31-symbol Crockford-style alphabet (no `I O 0 1`),
  ~28.6M per market-day; a rare collision is retried a bounded number of times against the
  unique `bets.publicRef` index. Generated server-side, never client-controlled, not sequential,
  `immutable` in the schema so it survives every future edit, and never regenerated on an
  idempotent replay. It is not returned until the transaction has committed.

### Window 4A4 implementation clarification (no business rule changed)

Bet editing (`PATCH /api/bets/:id`), immutable `betRevisions`, and the player bet **read**
backend (`GET /api/bets`, `GET /api/bets/:id`). Backend / financial domain only — no My Bets /
ticket / edit UI. The frozen rules above ("BET EDITING", "BET REVISIONS", the ₹1 minimum, no
maximum, a bet cannot exceed available balance, the immutable payout snapshot, one wallet
transaction per money movement) are implemented, not altered. The roadmap lists "My Bets" under
Window 5; only its read **backend** is built here (no UI), which the Window 5 UI and the edit
screen both need.

- **Editing is same-identity.** An edit re-uses the SAME `normalizeBetEntry` engine as quote /
  placement (never a second parser) and preserves `Bet._id`, `publicRef`, `userId`,
  `marketId`, `marketRoundId` and `placedAt`. Only `version` advances (1 → 2 → 3 …) and
  `lastEditedAt` is set. `PATCH /api/bets/:id` accepts only the entry method's raw input
  (`numbers` / `digits` / `rawInput` + `palti`), `stakePaise`, `expectedVersion` and
  `editRequestId` — a `.strict()` schema rejects every authoritative value and also `marketSlug`
  (an edit cannot move a bet to another market/round — that would be a new bet).
- **Payout multiplier is frozen at placement.** An edit NEVER re-reads
  `platformSettings.payoutMultiplier`. `bet.payoutMultiplierSnapshot` is untouched by every
  edit, so a bet placed at 90× stays 90× even if the admin rate is later 95×.
- **Edit cutoff is server time, re-checked at the transactional boundary.** Editing is allowed
  only while the bet is `ACTIVE` and `now < editCutoffAt` for the bet's OWN round
  (`editCutoffAt = closesAt − 60 min`). The `getBettingWindow(...).canEditBet` gate is checked
  before the transaction and **again inside it against a fresh clock** — a request that begins
  before cutoff but commits at/after it fails `EDIT_WINDOW_CLOSED` (or `MARKET_CLOSED` past
  close), with no change. New bet placement is unaffected and still runs until close.
- **One revision per successful edit, immutable.** Each edit writes exactly one `betRevisions`
  row: `betId`, `userId`, `fromVersion`, `toVersion`, full `before` / `after` canonical wager
  snapshots (`entryMethod`, `entryMetadata`, `selections`, `totalStakePaise`), `walletDeltaPaise`
  (`before.total − after.total`, schema-enforced), `editRequestId`, `editedAt`. Initial placement
  has no revision; the first edit creates `1 → 2`. History is exposed through the bet detail
  response (`revisions[]`, oldest first) — no `betId` / `userId` / `editRequestId` / Mongo `_id`
  in the DTO.
- **Wallet moves the difference only.** `stakeDelta = newTotalStakePaise − oldTotalStakePaise`.
  Positive → a single `BET_EDIT_DEBIT` of exactly `stakeDelta`; negative → a single
  `BET_EDIT_REFUND` of exactly `−stakeDelta`; zero → **no** wallet movement (the revision is
  still written). The whole bet is never refunded and re-debited. Keys are deterministic —
  `BET_EDIT_DEBIT:<betId>:v<toVersion>` / `BET_EDIT_REFUND:<betId>:v<toVersion>`.
- **One transaction, no partial success.** Re-read + re-validate the bet / round → wallet
  delta + ledger row → CAS `Bet` update (`version`/`status` filter) → `betRevisions` insert
  commit or roll back together. An insufficient balance, a market-state failure, a stale
  version or any later failure leaves the bet, its version, the wallet and the ledger unchanged
  and writes no revision.
- **Optimistic concurrency on `version`.** The request carries `expectedVersion`; the
  in-session re-read plus a compare-and-set `updateOne({ version: expectedVersion, status:
  "ACTIVE" })` plus the unique `betRevisions (betId, toVersion)` index mean two edits racing
  from the same version cannot both win — the loser gets `STALE_VERSION` (409), never a silent
  overwrite. A stale `expectedVersion` is `STALE_VERSION` before any wallet movement.
- **`editRequestId` idempotency.** Backed by the unique `betRevisions (userId, editRequestId)`
  index. A retry of the *same* logical edit (same target canonical wager) returns the
  ALREADY-APPLIED bet — no second wallet movement, no second version bump — and does so
  **before** the cutoff re-check, so a replay after cutoff still returns the previous successful
  result rather than `EDIT_WINDOW_CLOSED`. The same id reused for a *different* target wager is
  `DUPLICATE_REQUEST` (409).
- **Reads are owner-only.** `GET /api/bets` returns only the caller's bets, newest first,
  always bounded (`limit` 1–50, default 20, opaque cursor). `GET /api/bets/:id` resolves the
  bet's `id` handle OR its `publicRef` and 404s (`BET_NOT_FOUND`) for a missing OR non-owned
  bet identically — knowing a `publicRef` never grants access. `canEditNow` is
  `getBettingWindow` for the bet's own round; `result` is the round's; settlement fields
  (`winningNumber` / `payoutPaise` / `settledAt`) are `null` until the settlement engine exists
  and are never fabricated.

## BET EDITING

A player may edit the ENTIRE bet until:

```text
market close - 60 minutes
```

For example:

```text
Faridabad close: 5:50 PM
Edit allowed until: 4:50 PM
```

Before cutoff the player can:

* add selections
* remove selections
* change stake
* change the whole composition
* reconstruct/edit the original entry method
* change Jodi/Crossing/Copy Paste input as required

New bet placement itself remains allowed until market closing time.

After edit cutoff:

```text
new bets allowed until close
existing bet edits not allowed
```

Server time determines eligibility.

## BET REVISIONS

Editing MUST NOT destroy previous history.

Use a separate:

```text
betRevisions
```

collection.

The original bet has:

```text
version
```

and retains the same user-facing bet reference.

A revision should record enough before/after data to understand the complete edit and wallet delta.

Example:

```text
Bet #FB-0906-X7K29

Version 1
22,48,91
₹10 each
₹30

Version 2
22,48,67,91
₹10 each
₹40

Wallet adjustment: -₹10
```

## WALLET MODEL

Each player has one wallet.

Store:

```text
availableBalancePaise
reservedBalancePaise
currency
```

No negative balances.

Reserved balance cannot be used for betting.

Every money movement must create a wallet transaction.

Do NOT use direct invisible balance overrides.

## WALLET TRANSACTION TYPES

Support/document these prototype transaction types:

```text
MOCK_DEPOSIT

BET_PLACED

BET_EDIT_DEBIT
BET_EDIT_REFUND

WIN_CREDIT

WITHDRAWAL_RESERVED
WITHDRAWAL_RELEASED
WITHDRAWAL_APPROVED

ADMIN_CREDIT
ADMIN_DEBIT
```

Use delta-based representation capable of modeling movement between available and reserved balances.

A withdrawal reservation is:

```text
available - amount
reserved + amount
```

not a simple wallet debit.

## MOCK DEPOSIT

Prototype only.

No real gateway.

Rules:

```text
minimum = ₹1
maximum = none
```

Mock deposit credits available wallet and creates a ledger record.

### Window 4A2 implementation clarification (no business rule changed)

The frozen wallet rules above (one wallet per player, available vs reserved, no negative
balances, every movement ledgered, the ten transaction types, Mock Deposit ₹1 minimum / no
maximum) are implemented as the reusable wallet core. Nothing was altered.

- **Type → balance-movement is a frozen table, derived by the service.** `movementDeltas(type,
  amountPaise)` is the single authoring point for `(availableDeltaPaise, reservedDeltaPaise)`:
  `MOCK_DEPOSIT` / `BET_EDIT_REFUND` / `WIN_CREDIT` / `ADMIN_CREDIT` → `+amount` available;
  `BET_PLACED` / `BET_EDIT_DEBIT` / `ADMIN_DEBIT` → `-amount` available; `WITHDRAWAL_RESERVED`
  → `-amount` available `+amount` reserved; `WITHDRAWAL_RELEASED` → `+amount` available
  `-amount` reserved; `WITHDRAWAL_APPROVED` → `-amount` reserved only. The service never
  accepts deltas from a caller, so an impossible delta can never be paired with a type; the
  `walletTransactions` model's `pre("validate")` reconciliation is the independent backstop.
- **Available vs reserved.** `availableBalancePaise` funds betting, withdrawal reservation and
  admin debit. `reservedBalancePaise` is money already held for a pending withdrawal — it is
  never spendable for a bet, another reservation or a normal admin debit. A debit filters on
  `availableBalancePaise >= amount` (reserved debits on `reservedBalancePaise >= amount`), so
  balances can never go negative. Window 4A2 implements the reserve/release/finalize
  primitives; it creates **no** `withdrawals` document.
- **Ledger is append-only in normal operation.** Every balance mutation writes exactly one
  `walletTransactions` row inside the same MongoDB transaction — there is no "balance changed
  but ledger absent" or "ledger exists but balance unchanged" state. Corrections are
  compensating entries, never edits/deletes. The only deletion exception remains a future hard
  player purge.
- **Idempotency.** Every movement carries a globally unique `idempotencyKey`. The same key +
  the same logical operation returns the original result without moving money again; the same
  key + a different `type`/`amount`/`user` is rejected `DUPLICATE_REQUEST` (409). Mock Deposit
  builds its key deterministically as `MOCK_DEPOSIT:<userId>:<clientRequestId>` — the amount is
  never part of the key, so two different request ids are two intentional deposits and a
  repeated request id credits once. Future keys follow the same scheme
  (`BET_PLACED:<betId>`, `WIN_CREDIT:<betId>`, `WITHDRAWAL_RESERVED:<withdrawalId>`, …).
- **Wallet creation is ₹0, ledger-free, idempotent.** `createPlayerWallet(userId)` upserts a
  zero-value wallet; it never grants funds. Admin "create player" (a later window) calls it
  inside its transaction; the player wallet read/deposit APIs call it opportunistically so a
  player always has a wallet regardless of creation order. Any real starting balance is a
  later, separately ledgered admin movement.
- **Mock Deposit is validated at ₹1 minimum with no product maximum** — only safe-integer
  precision applies (`MONEY_OUT_OF_RANGE` beyond it, `INVALID_AMOUNT` below ₹1). It honours
  `platformSettings.mockDepositEnabled`. No gateway, no Razorpay, no UPI, no async settlement:
  an immediate ledgered credit.

## WITHDRAWAL

Prototype methods:

```text
BANK
UPI
```

Status:

```text
PENDING
APPROVED
REJECTED
CANCELLED
```

On request:

```text
available balance decreases
reserved balance increases
status = PENDING
```

Player may cancel only while `PENDING`.

Cancel:

```text
reserved released back to available
status = CANCELLED
```

Admin reject:

```text
reserved released
status = REJECTED
rejection reason stored
```

Admin approve:

```text
reserved amount finalized
status = APPROVED
```

No real bank transfer occurs in prototype.

Minimum withdrawal:

```text
₹1
```

Maximum:

```text
available balance
```

### Window 5A implementation clarification (no business rule changed)

The frozen withdrawal rules above (BANK / UPI, the four states, request reserves
available→reserved, player cancel only while PENDING, admin reject releases, admin approve
finalises, ₹1 minimum, maximum = available balance, no real payout) are implemented as the
**player** lifecycle plus reusable admin primitives. Nothing was altered.

- **Request is one atomic transaction.** `requestWithdrawal` validates an ACTIVE PLAYER + the
  Zod-checked request, ensures a ₹0 wallet, then in ONE Mongo transaction: `reserveInSession`
  (`available -= X`, `reserved += X`, one immutable `WITHDRAWAL_RESERVED` ledger row) → native
  insert of the `PENDING` `withdrawals` document. Any failure — below-min amount, insufficient
  available balance, a write error — leaves **no** withdrawal, **no** wallet change and **no**
  ledger row. The maximum is enforced by the reserve primitive (`INSUFFICIENT_BALANCE` when
  `available < X`), not a product constant; the ₹1 minimum is `assertWithdrawalAmount`
  (`INVALID_AMOUNT` below ₹1, `MONEY_OUT_OF_RANGE` beyond safe-integer precision).
- **Reserved funds are inert.** They cannot fund a bet, another withdrawal or a normal admin
  debit, and they stay reserved for the whole PENDING lifetime (the Window 4A2 available/reserved
  split does this — no new mechanism).
- **Every terminal transition is atomic and compare-and-set.** Cancel / reject / approve each
  run one transaction that moves the wallet through a Window 4A2 primitive AND flips the status
  with `updateOne({ status: "PENDING" }, …)`. `matchedCount 0` (a concurrent transition already
  won) aborts the whole transaction, rolling the wallet movement back with it. There is never a
  "withdrawal changed but wallet didn't", or the reverse.
  - **cancel** (player, own PENDING only): `PENDING → CANCELLED`, `available += X`,
    `reserved -= X`, one `WITHDRAWAL_RELEASED` row. The withdrawal is **not** deleted. An
    already-CANCELLED withdrawal returns its DTO with no second release; APPROVED / REJECTED is
    `WITHDRAWAL_NOT_PENDING` (409).
  - **reject** (future admin — primitive only, NOT routed in 5A): `PENDING → REJECTED` + stored
    reason, `available += X`, `reserved -= X`, one `WITHDRAWAL_RELEASED` row.
  - **approve** (future admin — primitive only, NOT routed in 5A): `PENDING → APPROVED`,
    `reserved -= X` only, available unchanged, one `WITHDRAWAL_APPROVED` row. No real bank/UPI
    payout occurs.
- **Idempotency.** The request carries a client UUID `clientRequestId`; a unique
  `(userId, clientRequestId)` index is the backstop. A retry with the same logical request
  (method + amount + destination) returns the ORIGINAL withdrawal — no second reserve, no
  duplicate ledger row; a conflicting payload under the same id is `DUPLICATE_REQUEST` (409).
  Two simultaneous identical requests resolve to one withdrawal / one reserve / one ledger row.
  Cancellation idempotency is deterministic on the withdrawal's own state plus the deterministic
  `WITHDRAWAL_RELEASED:<withdrawalId>` ledger key — a retried or raced cancel releases the
  reserved money exactly once and reserved balance never goes negative.
- **Ledger keys** follow the established `<TYPE>:<entityId>` scheme:
  `WITHDRAWAL_RESERVED:<withdrawalId>` (request), `WITHDRAWAL_RELEASED:<withdrawalId>`
  (cancel / reject — mutually exclusive, so the shared key is safe), `WITHDRAWAL_APPROVED:<withdrawalId>`
  (approve). `referenceType` is `"WITHDRAWAL"`, `referenceId` the withdrawal `_id`.
- **Sensitive payout details.** `withdrawals.paymentDetails` (account number / IFSC / UPI id) is
  written once and `select: false`; player list / detail / cancel responses never read or
  return it. Every response carries only a pre-masked `destination.summary`
  (`"HDFC Bank ••••1234"` / `"ra••@okhdfcbank"`), stored denormalised as `destinationSummary`.
  The duplicated `confirmAccountNumber` a BANK request carries is validated for equality and
  never persisted. At-rest **encryption** of `paymentDetails` is NOT part of the current
  prototype architecture (DATABASE.md only requires "excluded from ordinary queries"); it is
  recorded as future production hardening, not invented here as a weak custom scheme.

## RESULT + SETTLEMENT

Admin manually enters one 2-digit result for a closed market round.

Result is:

```text
"00" through "99"
```

as a string.

Admin cannot normally declare result before market close.

Result flow:

```text
Market closes
→ Result pending
→ Admin enters result
→ Review/confirmation
→ Result declared
→ Settlement processing
→ SETTLED
```

Once settled, normal admin UI must not allow result editing.

Settlement compares each normalized selection against the winning number.

If matching:

```text
credit = stake × payoutMultiplierSnapshot
```

Bet statuses:

```text
ACTIVE
WON
LOST
```

Settlement must be idempotent.

Running the same settlement twice must not credit winners twice.

Prefer scalable batch settlement rather than one enormous transaction across every bet.

Each individual bet settlement that moves wallet funds must be safely transactional/idempotent.

## PLAYER AUTHENTICATION

There is:

```text
NO PUBLIC SIGNUP
NO CREATE ACCOUNT BUTTON
NO /register
NO /signup
```

Players are created exclusively by Admin.

Player default login:

```text
Login ID
+
Password
```

Secondary option:

```text
Login with OTP
```

Prototype OTP is mock/provider-abstracted.

Player login IDs must be unique and normalized consistently.

Password is never stored plaintext.

Use secure password hashing.

## ADMIN AUTHENTICATION

Admin account also exists in MongoDB using the same identity model.

Use:

```text
users.role
```

Current prototype roles:

```text
PLAYER
ADMIN
```

Do NOT build complex RBAC yet.

Admin receives protected `/admin/*` access.

Every admin operation must be authorized server-side.

Never trust client `isAdmin` state or localStorage flags.

Initial admin must be created from environment variables through a seed/create-admin script.

Never hardcode a default admin password in source.

## SESSIONS

Use server-backed sessions suitable for immediate invalidation.

Persist sessions in MongoDB.

Browser should use a secure HttpOnly cookie.

Do not use localStorage as the authentication authority.

Protected request checks should include:

```text
session valid?
user still exists?
user ACTIVE?
correct role?
```

Disabling/deleting a user should invalidate their access.

## OTP

Store OTP request metadata in MongoDB.

Do not store plaintext OTP if avoidable.

Use hashed code storage.

Include:

* expiry
* attempts
* consumed state
* purpose
* user association

Use TTL index for automatic expiry cleanup.

Create provider abstraction such as:

```text
OtpProvider
  ├── MockOtpProvider
  └── future SmsOtpProvider
```

Only mock implementation is required now.

## PLAYER CREATION / ADMIN USER MANAGEMENT

Admin must be able eventually to:

* see total player count
* search players
* create players
* activate players
* disable players
* hard-delete players
* reset player password
* view wallet
* adjust wallet
* view bets
* view revisions

Do not implement the full admin UI in this window, but document it correctly.

Player creation initializes:

```text
User
+
₹0 wallet
```

Any initial balance is a separate admin wallet adjustment, not a hidden starting balance field.

## PLAYER HARD DELETE — IMPORTANT

This project specifically requires **complete player data purge**.

This is NOT a soft delete.

When admin deletes a player, remove all application-held data belonging to that player, including as applicable:

```text
user
sessions
OTP records
wallet
wallet transactions
bets
bet revisions
withdrawals
user-identifying audit records
```

There must be no user profile/history retained by this prototype after deletion.

Their previous login credentials stop working because the user no longer exists.

Do NOT create a tombstone/deny-list containing deleted login IDs just to prevent reuse, because that would intentionally retain a deleted identifier.

A future admin may deliberately create an entirely new account with the same login ID if that identifier is available.

That would be a new account, not restoration of the deleted account.

Create a centralized future service boundary:

```text
playerDeletionService.purgePlayer()
```

Do not scatter deletion logic through UI/API handlers.

## AUDIT LOGS

Admin-sensitive actions should support an immutable audit history while the related data exists.

Examples:

```text
PLAYER_CREATED
PLAYER_DISABLED
MARKET_DISABLED
MARKET_TIME_CHANGED
RESULT_DECLARED
GAME_RATE_CHANGED
WALLET_ADJUSTMENT
WITHDRAWAL_APPROVED
WITHDRAWAL_REJECTED
```

However, player hard deletion must also remove audit records that retain identifying data about that deleted player.

A generic non-identifying event such as:

```text
PLAYER_DELETION_COMPLETED
timestamp
actorAdminId
```

may remain only if it contains no deleted player identifier/name/login/phone/entity reference capable of linking back to them.

### Window 6A1 implementation clarification (no business rule changed)

The frozen rules above (₹0 wallet on player creation with any opening balance as a separate
audited movement; complete hard-delete purge with no tombstone / deny-list; redacted admin audit
on every meaningful action; the ten wallet transaction types; no negative balances; reserved is
never spendable; every movement ledgered; no independent ledger / bet editing) are implemented,
not altered.

- **LOCKED V1 money-in flow — manual, no gateway.** There is no payment gateway, no Razorpay, no
  UPI collect, no async settlement in V1. A player pays the admin **outside Diamond**
  (UPI / cash / bank), the admin verifies that payment, then credits the Diamond wallet through
  `POST /api/admin/players/[id]/wallet/credit`, and the system records an immutable `ADMIN_CREDIT`
  (`available += amount`). `paymentReference` (a UTR / txn id) and a required `reason` are stored
  on the ledger row and the audit row. Mock Deposit (`MOCK_DEPOSIT`) remains a separate
  prototype-only player convenience and is unrelated to this operational flow.
- **`ADMIN_DEBIT` is the correction mirror.** Manual reversal of an accidental credit or a
  controlled adjustment: `available -= amount`, never below zero (`INSUFFICIENT_BALANCE`),
  `reserved` untouched. The earlier ledger row is never edited or deleted — a correction is a new
  compensating `ADMIN_DEBIT` row with its own reason.
- **Money-out is unchanged and stays Window 5A / 6A2.** Withdrawal request still moves
  `available → reserved` immediately (PENDING). 6A1 exposes NO admin approve / reject route; the
  Window 5A internal `approveWithdrawalByAdmin` / `rejectWithdrawalByAdmin` primitives are
  untouched and Window 6A2 will route them under "Mark Paid & Approve" (approval finalizes
  RESERVED only — never a second debit of available).
- **Admin wallet movement is atomic and idempotent.** wallet balance change + immutable
  `walletTransactions` row + redacted `auditLogs` row are one MongoDB transaction — any failure
  moves no money. The resulting balance is computed by the wallet core, never accepted from the
  client. Idempotency key `ADMIN_WALLET_ADJUSTMENT:<adminId>:<clientRequestId>` is
  operation-agnostic: an exact replay returns the original receipt; the same request id with a
  different player / operation / amount / reason / reference is `DUPLICATE_REQUEST` (backed by the
  unique `idempotencyKey` index, not an in-memory check).
- **Admin player lifecycle.** Create forces `role: PLAYER` (no public signup, no admin creation
  via API) + a ₹0 wallet + `PLAYER_CREATED`, all atomic. Disable (`ACTIVE → DISABLED`) revokes
  every session in the same transaction and blocks future login; enable (`DISABLED → ACTIVE`)
  does not recreate sessions. Admin password reset hashes the new value, revokes every session,
  never returns the hash, and is not a player self-service flow. All are idempotent and only ever
  act on a PLAYER — an ADMIN target is an indistinguishable `PLAYER_NOT_FOUND`.
- **Hard purge** runs through the single `playerDeletionService.purgePlayer()` boundary in one
  transaction: `betRevisions`, `bets`, `withdrawals`, `walletTransactions`, `wallets`,
  `sessions`, `otpRequests`, every `auditLogs` row whose `subjectUserId` / `entityId` is the
  player, then the `user`. The surviving `PLAYER_DELETION_COMPLETED` row carries only
  `actorAdminId` + `action` + timestamp. ADMIN accounts are never purgeable here. The freed
  `loginId` may later back an entirely new, unrelated account.
- **No admin bet / ledger editing.** Admin may read bets, revisions and the ledger; there is no
  route or service to edit a `Bet`, delete a `Bet` / `BetRevision`, or mutate a
  `walletTransactions` row. Player deletion remains the only path that removes financial history,
  and only as part of removing the whole player.

### Window 6A2 implementation clarification (no business rule changed)

The frozen rules above (the four withdrawal states + their balance moves, admin approve
finalises RESERVED / admin reject releases, no real payout; one 2-digit **string** result for a
**closed** round with a review/confirmation step, no settlement editing once settled; rate
changes affect only future bet snapshots; redacted admin audit on every meaningful action) are
implemented as the admin operations backend — not altered.

- **Manual withdrawal, end to end.** Player requests → Window 5A moves `available → reserved`,
  status PENDING → **the admin transfers the money outside Diamond** → the admin calls
  **Mark Paid & Approve** with an explicit `confirmPaid: true` (a request without it never
  approves) → the system finalises RESERVED (`reserved -= X`, **available unchanged — never a
  second debit**), `PENDING → APPROVED`, immutable `WITHDRAWAL_APPROVED` ledger + audit. There
  is **no automatic payout** and no real bank/UPI API. Reject: `reserved -= X`, `available += X`,
  `PENDING → REJECTED` + stored reason, `WITHDRAWAL_RELEASED` ledger + `WITHDRAWAL_REJECTED`
  audit; no earlier transaction is edited or deleted.
- **Withdrawal decision idempotency / concurrency.** DB-backed on `withdrawals.decisionRequestId`
  (a client UUID, unique sparse index). An exact `(withdrawal, clientRequestId)` replay with the
  same payload returns the original success; the same id for a different withdrawal, a
  materially different decision (different `paymentReference` / note / reason), or the opposite
  operation is `DUPLICATE_REQUEST`. Concurrent approve‖approve, reject‖reject, approve‖reject and
  player-cancel‖admin-decision each resolve to exactly one terminal transition, one ledger row,
  one audit row (the Window 5A CAS on `status:"PENDING"`); reserved balance never goes negative;
  the wallet always matches the winner.
- **Sensitive payout details.** The raw BANK / UPI instrument (`withdrawals.paymentDetails`,
  `select:false`) is returned by exactly one endpoint — the ADMIN-only
  `GET /api/admin/withdrawals/[id]` — so the admin can make the real transfer. It is never in a
  list DTO, an audit `before` / `after`, a generic error, or a log. At-rest encryption of
  `paymentDetails` remains documented future production hardening, not invented here.
- **Market configuration vs history.** Enable / disable and schedule edits change only the
  `markets` config row. Emergency disable blocks new betting immediately through the existing
  server-authoritative eligibility checks — no per-round mutation. Persisted `marketRounds`
  snapshots (`opensAt` / `editCutoffAt` / `closesAt`) are **never rewritten**; a schedule change
  applies to rounds created after it, so today's already-materialised round keeps its instants.
  Audit: `MARKET_ENABLED` / `MARKET_DISABLED` / `MARKET_SCHEDULE_UPDATED` (concrete names for
  the example `MARKET_TIME_CHANGED` placeholder).
- **Result declaration is declaration only.** A deliberate two-step backend contract:
  `prepare` validates + previews with an explicit "settlement has NOT occurred" warning and
  mutates nothing; `declare` requires `confirm: true` + a client UUID and writes
  `marketRounds.result` + `resultDeclaredAt` + `declaredByAdminId` + a `RESULT_DECLARED` audit.
  Allowed only when server time `>= closesAt` (exactly at close allowed; before → `RESULT_TOO_EARLY`).
  The result is a two-character **string** `"00".."99"` — leading zero preserved, no numeric
  coercion. It **never** settles: no `Bet` WON/LOST, no `WIN_CREDIT`, no wallet winnings, no
  settlement summary; `settlementStatus` stays `PENDING`. A round that already has a result is
  `RESULT_ALREADY_DECLARED` — there is no unrestricted correction endpoint (settlement, and an
  immutable settled result, are Window 7A). Idempotency is DB-backed on
  `marketRounds.resultDeclaredRequestId`.
- **Payout rate is future-only.** `platformSettings.payoutMultiplier` update (validated,
  server-authoritative, `PAYOUT_RATE_UPDATED` audit with safe before/after) affects only
  subsequent bet placements. Bet placement already snapshots the live multiplier into
  `bets.payoutMultiplierSnapshot`; existing bets are **never** read or mass-updated, and Window
  7A settlement uses each bet's stored snapshot. Setting the current value is a no-op.
- **Admin audit browser.** Read-only, bounded, filterable; `before` / `after` re-redacted on
  read so no password / hash / token / OTP / session secret can appear. The 6A1 redaction
  writer stays authoritative.
- **No admin bet mutation.** The global admin bet list / detail (+ revision history) is READ
  ONLY — no route or service edits, deletes, or re-versions a `Bet` or `BetRevision`.

## USER-FACING BET REFERENCE

Never expose Mongo ObjectId as the primary user-facing ticket/bet number.

Every bet will eventually receive a unique public reference.

Example format style:

```text
FB-0906-X7K29
```

Exact implementation may vary, but it must be:

* reasonably short
* human-readable
* unique
* indexed
* safe to search in Player My Bets and Admin Bets
* separate from Mongo `_id`

## IDEMPOTENCY

Design foundation for duplicate-request protection.

Bet confirmation must eventually accept a client-generated unique request ID.

A double-click/network retry must not place two bets or debit wallet twice.

Design/document unique keys such as:

```text
userId + clientRequestId
```

Financial transaction idempotency keys should also be supported.

Examples conceptually:

```text
BET_PLACE:<betId>
WIN:<betId>
WITHDRAW_RESERVE:<withdrawalId>
```

Exact implementation may use another clean deterministic scheme.
