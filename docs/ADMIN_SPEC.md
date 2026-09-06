# Admin experience

Read [CODEX_RULES.md](CODEX_RULES.md) first. These requirements are authoritative and originate from the approved Window 1 brief. DOMAIN_RULES.md owns business rules; the roadmap limits implementation scope. Future-facing descriptions do not imply implemented features.

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

## ADMIN UX — DOCUMENT SCREEN INVENTORY

Admin routes will eventually include:

```text
/admin/login
/admin/dashboard

/admin/players
/admin/players/new
/admin/players/[id]

/admin/markets
/admin/markets/[id]

/admin/results
/admin/bets
/admin/wallet
/admin/withdrawals
/admin/game-rate
/admin/audit
/admin/settings
```

Admin UI uses same premium visual family as player site.

It should not look like a generic CRUD dashboard.

Admin capabilities include:

```text
Dashboard

Players
Create
Search
Activate
Disable
Hard Delete
Reset Password

Wallet Adjustment

Markets
Edit timings
Enable/disable

Results
Declare result
Settlement review

Bets
View details
View revision history

Withdrawals
Approve
Reject

Game Rate

Audit Log

Settings
```

Admin cannot:

```text
arbitrarily edit a player's placed bet
delete historical bet records independently
delete ledger records independently
edit a settled result through normal UI
delete audit logs casually
```

Player deletion is the explicit exception where all user-associated information is purged together.

## Implementation status and destructive-action boundaries

No admin screens or admin HTTP operations are exposed in Window 1. Only the environment-driven bootstrap script creates an initial admin. Window 2 adds protected shells/authentication; Window 6 adds the full inventory above.

Player creation must transactionally create identity plus a zero wallet; an initial credit is a separate audited wallet-service movement. Player hard deletion requires a concrete confirmation flow and centralized purge of every application-held identifier/history, coordinated with concurrent writes. A generic non-identifying completion audit may remain, with no target ID or link. This exception does not permit independent ledger/bet deletion.

Market timing edits change future schedule configuration; existing persisted round instants remain snapshots. Result declaration reviews a closed round and a two-character result string, then uses an authorized service; settlement and retry state must be visible without allowing settled-result editing. Rate changes affect only future bet snapshots. All admin mutations must authorize ADMIN on the server and record a redacted audit event.
