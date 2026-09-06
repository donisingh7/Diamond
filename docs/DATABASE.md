# Database foundation

Read [CODEX_RULES.md](CODEX_RULES.md) first. These requirements are authoritative and originate from the approved Window 1 brief. DOMAIN_RULES.md owns business rules; the roadmap limits implementation scope. Future-facing descriptions do not imply implemented features.

## INITIAL MONGODB COLLECTIONS

Implement/document these primary collections:

```text
users
sessions
otpRequests

wallets
walletTransactions

markets
marketRounds

bets
betRevisions

withdrawals

auditLogs
platformSettings
```

Do NOT create separate collections merely because a screen is named:

```text
wins
resultHistory
transactionHistory
admins
jodiBets
crossingBets
copyPasteBets
```

Those views should derive from the canonical collections.

## MODEL SHAPES

Implement robust initial Mongoose models corresponding approximately to:

## users

```text
_id
role: PLAYER | ADMIN
loginId
name
phone?
email?
passwordHash
status: ACTIVE | DISABLED
createdBy?
passwordChangedAt?
lastLoginAt?
timestamps
```

Indexes:

```text
loginId unique
phone unique sparse when present
email unique sparse when present
```

Normalize loginId consistently.

---

## sessions

```text
_id
userId
tokenHash
expiresAt
lastSeenAt?
createdAt
```

Indexes:

```text
tokenHash unique
userId
expiresAt TTL
```

---

## otpRequests

```text
_id
userId
codeHash
purpose: LOGIN
attempts
expiresAt
consumedAt?
createdAt
```

Indexes:

```text
userId
expiresAt TTL
```

---

## wallets

```text
_id
userId
currency: INR
availableBalancePaise
reservedBalancePaise
timestamps
```

Index:

```text
userId unique
```

---

## walletTransactions

```text
_id
userId
walletId
type
amountPaise
availableDeltaPaise
reservedDeltaPaise
availableBeforePaise
availableAfterPaise
reservedBeforePaise
reservedAfterPaise
referenceType?
referenceId?
idempotencyKey
createdByAdminId?
createdAt
```

Indexes:

```text
userId + createdAt
referenceId
idempotencyKey unique
```

Use a model representation capable of safely storing integer currency values.

---

## markets

```text
_id
name
slug
code
timezone
openTimeMinutes
closeTimeMinutes
closeDayOffset
editLockMinutesBeforeClose
enabled
displayOrder
timestamps
```

Indexes:

```text
slug unique
code unique
```

---

## marketRounds

```text
_id
marketId
businessDate
opensAt
editCutoffAt
closesAt

result?

resultDeclaredAt?
declaredByAdminId?

settlementStatus:
  PENDING
  PROCESSING
  SETTLED
  FAILED

settledAt?

settlementSummary {
  totalBets
  winningBets
  losingBets
  totalStakePaise
  totalPayoutPaise
}

createdAt
updatedAt
```

Index:

```text
marketId + businessDate unique
```

Also useful:

```text
closesAt
```

---

## bets

```text
_id
publicRef
clientRequestId

userId
marketId
marketRoundId

entryMethod:
  JODI
  CROSSING
  COPY_PASTE

entryMetadata

selections [
  {
    number: "00".."99"
    stakePaise
  }
]

totalSelections
totalStakePaise

payoutMultiplierSnapshot

status:
  ACTIVE
  WON
  LOST

winningNumber?
payoutPaise?

version

placedAt
lastEditedAt?
settledAt?

timestamps
```

Indexes:

```text
publicRef unique
userId + createdAt
marketRoundId + status
marketId + createdAt
userId + clientRequestId unique
```

---

## betRevisions

```text
_id
betId
userId

fromVersion
toVersion

before {
  entryMethod
  entryMetadata
  selections
  totalStakePaise
}

after {
  entryMethod
  entryMetadata
  selections
  totalStakePaise
}

walletDeltaPaise

editRequestId
editedAt
```

Indexes:

```text
betId + toVersion unique
userId + editedAt
```

---

## withdrawals

```text
_id
userId
amountPaise

method:
  BANK
  UPI

paymentDetails

status:
  PENDING
  APPROVED
  REJECTED
  CANCELLED

rejectionReason?

requestedAt
decidedAt?
decidedByAdminId?

timestamps
```

Indexes:

```text
userId + createdAt
status + requestedAt
```

---

## auditLogs

```text
_id
actorAdminId
action
entityType
entityId?
subjectUserId?
before?
after?
createdAt
```

Indexes:

```text
createdAt
actorAdminId + createdAt
subjectUserId
```

---

## platformSettings

Prototype configuration includes:

```text
currency = INR
timezone = Asia/Kolkata
minimumStakePaise = 100
payoutMultiplier = 90
mockDepositEnabled = true
mockOtpEnabled = true
```

Use a clear singleton/settings strategy.

## MONGODB CONNECTION

Create robust reusable MongoDB connection handling suitable for Next.js development/hot reload.

Use environment variables.

Provide:

```text
.env.example
```

with names only / safe placeholder values.

Do NOT include secrets.

Expected concepts:

```text
MONGODB_URI
SESSION_SECRET or session-related secret as appropriate
SEED_ADMIN_LOGIN_ID
SEED_ADMIN_PASSWORD
```

Add other variables only if genuinely needed.

## MONGODB TRANSACTIONS

The architecture requires Mongo transactions for operations such as:

```text
bet creation + wallet debit
bet edit + wallet adjustment + revision
withdrawal reservation
withdrawal cancellation/rejection
winner credit
```

Document that local MongoDB must support transactions.

The developer setup should use either:

```text
MongoDB Atlas
```

or:

```text
local MongoDB replica set
```

Do not silently write transaction-dependent code that fails on a standalone local Mongo server without documenting the requirement.

## Implemented persistence details

There are exactly twelve primary collections. Every model is under its owning module, exported by `src/lib/db/models.ts` for explicit index provisioning. Mongoose automatic index creation is disabled. `db:seed` calls `createIndexes()` for all models, adding declared indexes without dropping existing indexes. Unique fields require the actual database index; validation alone cannot enforce uniqueness. Existing conflicting data/indexes must be inspected and repaired deliberately; the seed will fail instead of deleting records.

| Collection | Additional implementation decision |
| --- | --- |
| users | NFKC + trim + lowercase login ID normalization; email lowercase/trim; optional blank phone/email omitted for sparse uniqueness; passwordHash excluded from ordinary queries. Phone currently trimmed only; do not infer country codes. |
| sessions | Only token hash stored; expiresAt TTL zero seconds; explicit expiry checks remain mandatory because TTL cleanup is asynchronous. |
| otpRequests | Hashed code, LOGIN purpose, attempt count, expiresAt TTL and consumedAt; no persisted plaintext delivery code. |
| wallets | One unique userId; available and reserved start at zero; INR only; safe nonnegative integers. Only the future wallet service may update balances. |
| walletTransactions | Safe signed deltas, before/after reconciliation and type-specific movement validation. All ten required types; globally unique deterministic idempotencyKey. No independent delete/update UI. |
| markets | Schedule minute integers plus day offset; slug/code unique; valid close-after-open schedule. No mutable OPEN/CLOSED flag. |
| marketRounds | Unique marketId/businessDate, actual Date instants, result declaration metadata and settlement summary. Result string rejects number coercion. |
| bets | Unique publicRef; unique userId/clientRequestId; unique nonempty normalized selections, metadata shape matching method, validated count/total, immutable payout snapshot and publicRef. Domain version is distinct from Mongoose __v. |
| betRevisions | Full composition snapshots; successive from/to versions; wallet delta is before total minus after total. Unique betId/toVersion and added unique userId/editRequestId. |
| withdrawals | Added clientRequestId and unique userId/clientRequestId for retries. BANK uses accountHolderName/accountNumber/ifsc with optional bankName; UPI uses upiId. Sensitive paymentDetails excluded from ordinary queries. Preserve account numbers as strings. |
| auditLogs | before/after maps are flexible storage only; future service must allowlist values, remove secrets and tag subjectUserId on every player-associated record for complete purge. |
| platformSettings | Unique `key = platform` plus single allowed key provides singleton strategy. Initial rate 90 is in seed data, never settlement code. |

Bet entryMetadata is a strict subdocument: JODI `{numbers}`, CROSSING `{digits}`, COPY_PASTE `{rawInput, palti}`. Raw input is retained to reconstruct edits; normalized selections are settlement authority. Windows 4/7 must also verify metadata-to-selection equivalence and payout outcome invariants in services. No full parser is claimed in Window 1.

All balances, stakes, payouts and summary money values are validated safe integers. Counts and versions are safe integers too. The fixed minimum selection stake is 100 paise; ledger edit deltas may be smaller than 100 paise. Mongoose does not add database foreign-key constraints. Services own relation/role checks, state transitions, authorization and atomicity.

### Seed and reset semantics

`db:seed` requires seed credentials, verifies replica-set/sharded topology, provisions indexes, inserts missing platform settings/markets, and creates a missing admin. `$setOnInsert` preserves any existing admin credentials/status and market/settings edits. It does not reset the rate to 90 on each rerun. A player login collision is an error and must never promote the player. Partial seed progress is safe to rerun; this setup process is not a financial operation. It does not create daily rounds, players, wallets, bets or money.

`db:create-admin` is independently rerunnable and does not reset an existing password. `db:check` uses the real Mongoose connection and performs a transactional read, rather than claiming ping alone proves transaction support. The existing `db:test` diagnostic remains available; its automatic process-local DNS fallback is not silently applied to application connections. An explicit optional MONGODB_DNS_SERVERS setting is supported when the system resolver cannot resolve Atlas SRV. It accepts comma-separated IP addresses and changes Node DNS only for the server process; blank uses system DNS. This option was added after reproducing the local resolver failure and successfully checking transactions with the explicit resolver setting.

`db:reset` only runs when NODE_ENV is explicitly development, the connected database is named `diamond_dev` or `diamond_dev_<suffix>`, and `--confirm` matches the exact database name. It clears only known app collections and preserves indexes/unrelated collections. Stop all application writers before using it; reset is a development maintenance tool, not an atomic user-purge implementation. Do not run it against shared data. No reset is run as part of normal seeding.

### Transaction requirement

Use Atlas or a local replica set. A local example is `mongod --replSet rs0 --bind_ip 127.0.0.1 --dbpath <dedicated-directory>` followed once by `mongosh --eval 'rs.initiate()'`; wait for primary election, then connect to an explicit database with `?replicaSet=rs0`. Use your installed MongoDB tooling and a dedicated data directory. Standalone Mongo is not supported for financial features. No production infrastructure is provisioned in this window.

### Window 3A — index review and additions

No new collections. Markets and rounds still derive every view (today, 7-day, 30-day, per-market history) — no `resultHistory`/`wins`.

`markets`: `slug` unique and `code` unique are unchanged and sufficient (six rows, listing sorts in memory by `displayOrder`).

`marketRounds` preserved: `{ marketId: 1, businessDate: 1 }` unique (current-round lookup, per-market history, concurrency backstop) and `{ closesAt: 1 }`. **Added:** `{ businessDate: 1, marketId: 1 }` — the cross-market results-history query is a `businessDate` range across all markets sorted newest-first, which the `marketId`-leading unique index cannot serve. `result` presence is a residual `$exists` filter, not indexed (≤ 6 rows per business date). No other fields were indexed.

`ensureMarketRound` relies on the unique `(marketId, businessDate)` index as its race backstop: a lost create race throws E11000 and the winner is re-read rather than a duplicate inserted.
