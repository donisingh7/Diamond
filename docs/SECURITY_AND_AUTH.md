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

## Window 2B implementation

Window 2B is presentation/design work's authentication counterpart: server-authoritative password and OTP login, server-backed sessions, and route protection for the player and admin shells. **Window 2A's visual design (colors, glass strength, ticket appearance) remains pending a dedicated visual-browser refinement pass — this window only wired functional states into that existing presentation and did not redesign it.**

### Session token and cookie

`src/modules/auth/services/session.service.ts` generates a 32-byte `crypto.randomBytes` token (`base64url`, ≥40 chars), never a signed JWT. Only `createHmac("sha256", SESSION_SECRET).update(rawToken).digest("hex")` is persisted in `sessions.tokenHash` — the same HMAC-pepper strategy Window 1 already used for OTP codes. The raw token lives only in the browser's `diamond_session` cookie (`src/lib/auth/session.ts`): `HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV==="production"` (explicitly omitted on local HTTP), `Path=/`, `Max-Age` matching `SESSION_DURATION_MS` (7 days, `src/modules/auth/config.ts`). Cookie name/duration/OTP parameters are centralized there and imported by both server and client code — no magic numbers scattered through routes or components.

### Session validation lifecycle

Every read goes through `findActiveSessionUser(rawToken)`: hash the token, look up the session, explicitly reject (and delete) an expired session rather than trusting the TTL index, reload the user by id, and reject (and delete) the session if the user is missing or not `ACTIVE`. `lastSeenAt` is touched fire-and-forget. This means a disabled or hard-deleted user's existing cookie stops working on its very next request — no proactive session sweep is needed for that guarantee, though `revokeAllUserSessions(userId)` exists as the reusable primitive Window 5/6 password-reset and admin-disable flows should call for immediate, proactive invalidation. `src/lib/auth/session.ts` wraps the cookie-reading entrypoint (`getCurrentUser`) in React's `cache()` so a protected layout and its page share one lookup per request; `requireAuthenticatedUser`/`requirePlayer`/`requireAdmin` throw `DomainError("UNAUTHENTICATED"|"FORBIDDEN", …)` for reuse by future API routes, while Server Component layouts call `getCurrentUser()` directly and `redirect()` inline (idiomatic for the App Router; exceptions don't cross that boundary cleanly).

### Route authorization

`src/app/(player)/layout.tsx` and `src/app/admin/(protected)/layout.tsx` are the enforcement points — both Next.js route groups, not URL segments, so grouping is invisible in the URL but keeps the public login pages (`src/app/login`, `src/app/admin/login`, siblings of the groups) completely outside the protected layout's tree and immune to redirect loops. No unauthenticated player reaches `/`; no unauthenticated admin reaches `/admin`; a `PLAYER` hitting `/admin` (or `/admin/login` while already signed in) is redirected to `/`, and an `ADMIN` hitting `/` (or `/login` while already signed in) is redirected to `/admin`. This is server-side on every request — there is no client-only `useEffect` gate. `/login` and `/admin/login` themselves redirect an already-authenticated visitor away before rendering the form.

### Password login

`src/modules/auth/services/login.service.ts` takes `{loginId, password, portal}`. The client declares the intended portal, but the server is authoritative: a missing user, a role that doesn't match `portal`, and a wrong password all produce the identical `INVALID_CREDENTIALS` / "Invalid credentials." response — an admin cannot authenticate through the player portal (or vice versa) merely by having valid credentials for the other role. A missing user or wrong-portal request still runs a real scrypt derivation against a lazily-computed dummy hash before rejecting, so the response time doesn't distinguish "no such account" from "wrong password" (both pay the same scrypt cost). Only once a password is proven *correct* does a disabled account get the more specific `USER_DISABLED` (403) response — SECURITY_AND_AUTH.md's enumeration guidance treats that as an acceptable, narrower disclosure at that point.

### OTP login

Player-only; `src/modules/auth/services/otp.service.ts`. `requestPlayerOtp(phone)` looks up an `ACTIVE` `PLAYER` by phone; for anything else (unknown phone, disabled player, an admin's phone, or `platformSettings.mockOtpEnabled === false`) it returns a same-shaped decoy `requestId` (a fresh ObjectId hex string) without creating any `otpRequests` row — verifying against that id fails exactly like a wrong code, so the endpoint never discloses which phones are registered. A real request within `OTP_RESEND_COOLDOWN_MS` (60s) of an unconsumed one reuses the existing `requestId` instead of minting a new code. Expiry is `OTP_EXPIRY_MS` (5 minutes); `OTP_MAX_ATTEMPTS` is 5. `verifyPlayerOtp` compares the submitted code's HMAC against the stored `codeHash` with `timingSafeEqual`; a wrong code increments `attempts` **outside** any transaction (a wrong-code rejection still needs to persist the attempt, and throwing inside a Mongo transaction rolls back everything written in that callback — this was caught by the integration suite, not inspection). Only the success path — atomically consuming the OTP (`findOneAndUpdate` gated on `consumedAt: null`, so a retried/duplicate verify can never consume the same code twice) plus session creation — runs inside `withTransaction`.

### Mock OTP delivery

`MockOtpProvider` (Window 1) is unchanged; the app's default instance only `console.log`s the code when `NODE_ENV === "development"`, never in production, and never through a public endpoint. Separately, `requestPlayerOtp` returns an optional `devCode` field on its result only when `NODE_ENV === "development"`; the `/api/auth/otp/request` route forwards it verbatim (`undefined` is dropped by `JSON.stringify`, so production responses never carry it), and the login UI shows it in a small "Development preview" note using the same `.preview-notice` style Window 2A already had. Tests inject their own capturing `OtpProvider` instead of relying on `NODE_ENV`.

### API routes and DTOs

`POST /api/auth/login` (`{portal, loginId, password}`), `POST /api/auth/otp/request` (`{phone}` → always `{requestId, message}`, plus `devCode` in development), `POST /api/auth/otp/verify` (`{requestId, code}`), `POST /api/auth/logout` (cookie only, idempotent — an absent or already-invalid session still clears the cookie and returns success), `GET /api/auth/me` (cookie only, 401 if absent/expired/disabled/deleted). This is a deliberate, documented refinement of the original API_CONTRACTS.md sketch: login takes an explicit `portal` rather than inferring shell access purely from the returned role, because Window 2B's own brief required a wrong-portal login to fail outright rather than quietly succeed into the wrong shell. `src/lib/api/handler.ts`'s `apiRoute()` wrapper gives every route the same `{data:...}` / `{error:{code,message}}` shape; Zod failures become `400 INVALID_INPUT`, everything else maps through `httpStatusForError` (`src/lib/errors/domain-error.ts`). `toPublicUser()` (`src/modules/users/services/public-user.ts`) is the one allowlisted response shape (`id, role, loginId, name, phone, email, status`) — no route ever spreads a hydrated Mongoose document.

### CSRF / same-origin

`src/lib/http/same-origin.ts`'s `isTrustedOrigin()` rejects any of the four state-changing auth routes when the request carries an `Origin` header that doesn't match the request's own origin; a request with no `Origin` header (same-origin requests may omit it) is allowed. This is deliberately lightweight — `SameSite=Lax` already blocks the cookie on most cross-site requests, so this only needs to catch what that misses, without a CSRF-token framework. `GET /api/auth/me` is read-only and skips the check.

### Verified end-to-end

Beyond the automated suite, a disposable local MongoDB replica set was used to run the dev server and exercise real HTTP flows with `curl` and a cookie jar: public login pages, unauthenticated redirects, wrong/disabled/cross-portal login rejections, a full password login → `/api/auth/me` → logout → re-check cycle for both player and admin, the full OTP request → verify → session → replay-rejected cycle (using the real `devCode`), cross-role redirects in both directions, and a rejected cross-origin login attempt. The user's own configured `.env`/database was never touched or seeded.
