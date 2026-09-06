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

### Window 4A1 — no schema change

No new collections, models or indexes. The betting engines are pure and touch no database. `POST /api/bets/quote` writes **no** `bets` / `betRevisions` / `wallets` / `walletTransactions` document — it only reads `platformSettings` and `markets`, and may create the day's operational `marketRounds` row exactly as the Window 3A market/results reads already do. `platformSettings` gained a read-only accessor (`getPlatformSettings`) only; no mutation path and the seed default rate (90) is unchanged. The `bets.entryMetadata` sub-document shape (`{numbers}` | `{digits}` | `{rawInput, palti}`) and the `selections` array shape are unchanged — the engines produce exactly that shape for a future placement window to persist.

### Window 4A2 — wallet core: no wallet schema change, two new error codes

**No collection or index change.** `wallets` (`userId` unique) and `walletTransactions`
(`userId + createdAt`, `referenceId`, `idempotencyKey` unique) are used exactly as Window 1
defined them:

- `walletTransactions.idempotencyKey` unique index is the correctness backstop for
  duplicate-request protection — a concurrent duplicate movement collides here (E11000) and the
  standalone caller recovers the original outside the aborted transaction.
- `wallets` unique `userId` guarantees one wallet per player; `createPlayerWallet` upserts and
  recovers a lost create race by re-reading the winner.
- `{ userId: 1, createdAt: -1 }` on `walletTransactions` serves the newest-first
  `GET /api/wallet/transactions` page directly; the opaque cursor carries `(createdAt, _id)`.
- Balances mutate **only** through one conditional `findOneAndUpdate` (`$inc` with an
  `availableBalancePaise >= amount` / `reservedBalancePaise >= amount` guard) inside a
  transaction — never a document `.save()` read-modify-write. `optimisticConcurrency` in
  `schemaOptions` is irrelevant to that path (it only affects `.save()`).

Type-only additions to the two model files: `WalletRecord` / `WalletDoc`;
`WalletTransactionType` / `WalletTransactionRecord` / `WalletTransactionRow` (lean-read shape
with `_id` + `createdAt`) / `WalletTransactionDoc`. No field, validator, hook or index changed.

`lib/errors/domain-error.ts` gained `WALLET_NOT_FOUND` (404) and `INVALID_AMOUNT` (422).
`INSUFFICIENT_BALANCE` (422) and `DUPLICATE_REQUEST` (409) already existed and are reused
verbatim — `DUPLICATE_REQUEST` is the idempotency-key-reuse-with-different-payload conflict
(matching ARCHITECTURE.md's "Reuse with a different payload is DUPLICATE_REQUEST" rule); no
synonymous `IDEMPOTENCY_CONFLICT` code was added.

`src/modules/wallet/services/wallet.contract.ts` (the Window 1 `WalletService` interface
sketch) was deleted — superseded by the implemented `wallet.service.ts`, no importers.

Fixture note: integration tests may seed a `wallets` balance directly for isolated
concurrency/primitive checks (brief §41). Production/business code never initialises a balance
outside a ledgered movement — Mock Deposit and every future funding path go through
`applyWalletMovement`.

### Window 4A3 — bet placement: no schema or index change

**No collection, field, validator, hook or index was added or changed.** `bets` and
`walletTransactions` are used exactly as Window 1 / 4A2 defined them:

- **`bets` `{ userId: 1, clientRequestId: 1 }` unique** is the verified correctness backstop
  for client-request idempotency. A repeat of the same logical wager is recovered before the
  market-close re-check; the same id + a different logical wager is `DUPLICATE_REQUEST`; two
  simultaneous identical requests collide here (E11000) and the loser's whole transaction
  (debit + insert) rolls back, then the winner is re-read. Confirmed present by
  `schemas.test.ts` and exercised by `bet-placement.integration.ts`.
- **`bets` `{ publicRef: 1 }` unique** backs the human reference. `placeBet` picks a free
  `publicRef` with a bounded pre-check (`Bet.exists({ publicRef }).session(session)`,
  `PUBLIC_REF_MAX_ATTEMPTS = 5`) before inserting; the unique index is the final guarantee if a
  candidate is taken between the check and the insert.
- **`walletTransactions` `{ idempotencyKey: 1 }` unique** — the `BET_PLACED` row carries the
  deterministic key `BET_PLACED:<betId>` (matching the documented scheme), so a replay never
  double-credits and the row is reconstructable from the bet id. `referenceType: "BET"` /
  `referenceId: <betId>` (indexed) link the ledger row to the bet.
- The `Bet` document is inserted **with the native driver** inside the placement transaction
  (`Bet.collection.insertOne(betDoc.toObject(), { session })`) after `betDoc.validate()` runs
  the schema's `pre("validate")` invariants. A Mongoose document created inside a
  `connection.transaction()` session is reset on any retry, and resetting the `strict:"throw"`
  `entryMetadata` sub-document throws `StrictModeError`; the plain insert sidesteps that. The
  ODM validation still runs (before the insert); the unique indexes still enforce correctness.
- Type-only additions to `bet.model.ts`: `BetRecord` (`InferSchemaType`) and `BetDoc`
  (`HydratedDocument`). `platform-settings.service.ts`'s `getPlatformSettings` gained an
  optional `session?: ClientSession` parameter (backward-compatible) so the payout-multiplier
  snapshot can be read inside the placement transaction.

### Window 4A4 - bet editing & reads: no schema or index change, two new error codes

**No collection, field, validator, hook or index was added or changed.** `bets`,
`betRevisions` and `walletTransactions` are used exactly as Window 1 defined them:

- **`betRevisions {betId, toVersion}` unique** is the verified concurrency backstop for
  editing. Two edits racing from the same `version` both target `toVersion = version + 1`; one
  commits, the other's insert throws E11000 inside its aborted transaction and is surfaced as
  `STALE_VERSION`. Exercised by `bet-edit.integration.ts`.
- **`betRevisions {userId, editRequestId}` unique** is the `editRequestId` idempotency
  backstop. A concurrent duplicate collides here; the replay is recovered outside the aborted
  transaction (same target wager -> the already-applied bet, no second wallet movement;
  different target wager -> `DUPLICATE_REQUEST`).
- **`betRevisions {userId, editedAt}`** backs a future per-player revision history read; not
  yet routed.
- **`betRevisions.walletDeltaPaise`** is `before.totalStakePaise - after.totalStakePaise`
  (schema `pre("validate")` enforced): negative when the edit debited the wallet, positive
  when it refunded, zero for a same-total edit. Ledger edit deltas may be smaller than the
  100-paise selection minimum (an existing DATABASE.md note).
- **`bets {userId, clientRequestId}` / `bets.publicRef` / `bets.payoutMultiplierSnapshot`
  (immutable)** are untouched by an edit - the same identity is preserved and only `version`,
  `selections`, `entryMethod`, `entryMetadata`, `totalSelections`, `totalStakePaise` and
  `lastEditedAt` change, via a native-driver compare-and-set `updateOne({ _id, userId,
  version: expectedVersion, status: "ACTIVE" })` inside the transaction (the `(version,
  status)` filter is the atomic optimistic lock). `bets {userId, createdAt}` serves the
  newest-first `GET /api/bets` page directly; the opaque cursor carries `(createdAt, _id)`.
- **`walletTransactions {idempotencyKey}` unique** - the `BET_EDIT_DEBIT` / `BET_EDIT_REFUND`
  row carries the deterministic key `BET_EDIT_DEBIT:<betId>:v<toVersion>` /
  `BET_EDIT_REFUND:<betId>:v<toVersion>`, so a replay never double-moves and the row is
  reconstructable. `referenceType: "BET"` / `referenceId: <betId>` link it to the bet.
- The `Bet` update and the `BetRevision` insert use the **native driver** inside the
  transaction (`Bet.collection.updateOne` / `BetRevision.collection.insertOne`) for the same
  reason Window 4A3 used a plain insert - a Mongoose document created in a
  `connection.transaction()` session is reset on retry and resetting the `strict:"throw"`
  `entryMetadata` sub-document throws `StrictModeError`. The ODM `validate()` still runs first
  (on throwaway `new Bet(...)` / `new BetRevision(...)`) and the unique indexes still enforce
  correctness.

Type-only additions: `bet.model.ts` gained `BetRow` (lean-read shape = record + `_id` +
`createdAt` + `updatedAt`); `bet-revision.model.ts` gained `BetRevisionRecord`
(`InferSchemaType`), `BetRevisionDoc` (`HydratedDocument`) and `BetRevisionRow`. No field,
validator, hook or index changed.

`lib/errors/domain-error.ts` gained `BET_NOT_FOUND` (404 - a missing OR non-owned bet,
deliberately indistinguishable) and `STALE_VERSION` (409 - the `expectedVersion`
optimistic-concurrency conflict, matching API_CONTRACTS.md's "409 state/version/idempotency
conflict"). `BET_ALREADY_SETTLED` (409), `EDIT_WINDOW_CLOSED` (422), `DUPLICATE_REQUEST` (409)
and `INSUFFICIENT_BALANCE` (422) already existed and are reused verbatim; no synonymous codes
were added.
