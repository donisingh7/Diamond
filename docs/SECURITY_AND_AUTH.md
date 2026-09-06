# Security and authentication

Read [CODEX_RULES.md](CODEX_RULES.md) first. These requirements are authoritative and originate from the approved Window 1 brief. DOMAIN_RULES.md owns business rules; the roadmap limits implementation scope. Future-facing descriptions do not imply implemented features.

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

## Implemented security foundation and Window 2 obligations

Node's asynchronous scrypt uses N=131072, r=8, p=1, a random 16-byte salt and 64-byte derived key. Stored format is versioned (`scrypt-v1$saltHex$keyHex`); comparison is timing-safe. No password is logged or returned. Initial-admin environment validation requires 12?1024 characters as a bootstrap safeguard; the player password policy remains a Window 2 implementation decision to document. Existing admin credentials are never overwritten by seeding.

OTP generation uses cryptographic randomInt, and storage uses HMAC-SHA256 over request ID and code with SESSION_SECRET as pepper. A mock provider receives an explicitly injected delivery sink; there is no real SMS transport, automatic console logging or public code endpoint. Window 2 must choose a deliberate mock delivery UX gated by mockOtpEnabled. Expiry duration, attempt limit, request throttling, session lifetime and resend policy are not frozen here; choose/document these security parameters before exposing login. Never enable unbounded OTP attempts.

Sessions will use a random high-entropy opaque token in an HttpOnly, SameSite cookie, Secure over HTTPS; persist its hash rather than the raw token. Local HTTP development may explicitly omit Secure. SESSION_SECRET is required for OTP hashing; random session tokens do not require a signed JWT. Every protected request must look up the session, explicitly check expiry, then reread user existence/status/role. Password reset, disable, delete and logout must invalidate applicable sessions immediately. Add same-origin/CSRF protection to cookie-authenticated mutations and generic login errors that avoid account enumeration. No authentication routes are implemented yet.

Database/environment/password/provider modules are server-only. `select:false` protects ordinary queries but is not a redaction strategy for newly created documents or explicit selections; future routes must serialize allowlisted DTOs. Zod/database error details can contain inputs, so scripts emit only error class and setup guidance and APIs use `toPublicError`. Do not place credentials, token hashes, OTP hashes or payment account data in audit snapshots, URLs or client props.
