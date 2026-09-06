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
