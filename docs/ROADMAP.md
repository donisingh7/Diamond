# Implementation roadmap

Read [CODEX_RULES.md](CODEX_RULES.md) first. These requirements are authoritative and originate from the approved Window 1 brief. DOMAIN_RULES.md owns business rules; the roadmap limits implementation scope. Future-facing descriptions do not imply implemented features.

## ROADMAP.md

Document the remaining implementation windows exactly:

## Window 1

Documentation + Foundation

## Window 2

Premium Design System + Authentication + Player/Admin Application Shells

## Window 3

Player Home + Markets + Market Timing UX + Results

## Window 4

Complete Betting Engine + Jodi + Crossing + Copy Paste + Palti + Bet Slip + Premium Ticket + Bet Editing + Bet Revisions

## Window 5

Wallet + Mock Deposit + Withdrawals + My Bets + Win History + Transactions + Profile + Game Rate + How To Play

## Window 6

Complete Premium Admin Panel

## Window 7

Settlement Engine Completion + End-to-End Integration

## Window 8

Premium UI/UX Excellence Audit and Refinement

## Window 9

Architecture + Security + Race Condition + MongoDB + Performance + QA Audit

Future Codex windows should treat this roadmap as sequencing guidance, not permission to implement later windows early.

## Window 1 handoff status

Implemented: the eleven required documents, root AGENTS.md entry point, twelve canonical Mongoose models/index definitions, database connection/transaction foundation, Zod validators, exact money and market-time utilities, scrypt/OTP primitives, seed/create-admin/reset/check scripts, domain tests, and a minimal dark theme/Motion provider. Full betting normalization is deliberately deferred to Window 4 behind engine contracts.

Next is Window 2 only: premium shared components, authentication services and protected player/admin shells. Before exposing auth, settle/document session lifetime, OTP expiry/attempt/rate-limit policy, mock delivery UX, player password policy and CSRF handling. Install React Hook Form/shadcn primitives when those forms/components are built. No public registration, money services, dashboard implementation or settlement UI belongs to the Window 1 handoff.

## Verification record ? 2026-09-06

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS; strict TypeScript including source/scripts/tests/configs |
| `npm.cmd run lint` | PASS |
| `npm.cmd test` | PASS; 41 tests across four files |
| `npm.cmd run test:integration` | PASS; six tests against disposable MongoDB 8.2.6 replica set |
| `npm.cmd run build` | PASS; Next.js production output exposes only holding page and not-found |
| `npm.cmd run db:test` | PASS; original diagnostic needed its existing process-local DNS fallback |
| `$env:MONGODB_DNS_SERVERS = '1.1.1.1,8.8.8.8'` then `npm.cmd run db:check` | PASS; configured database connected through Mongoose and a transactional read succeeded |
| `npm.cmd run dev -- --port 3000` | PASS; server ready; HTTP GET / returned 200 with Diamond title and expected heading |
| Browser visual QA | Not performed: computer-use reported no available browser |
| `git diff --check` | PASS; no whitespace errors |

Replica-set integration verifies actual seed/create-admin CLI execution with test environment credentials, safe seed reruns, preserved settings/admin passwords, hashed password verification, all declared indexes, duplicate ledger-key rejection, player-login collision protection, and multi-document rollback/commit. Test database is disposable and does not load the user's database URI. The reset command was not run against the configured database; its three guards have unit coverage.

Initial sandboxed npm/build/database attempts encountered network/cache restrictions; allowed retries resolved package/font access. The initial sandboxed dev server used fallback fonts; it was restarted with network access and a fresh HTTP request succeeded without font warnings. The initial integration attempt timed out while downloading an additional Windows MongoDB binary. The final suite uses the cached/pinned 8.2.6 binary and permits a bounded longer cold-download setup; only explicit integration runs download binaries. The core test package avoids binary downloads during normal npm installation.

### Local setup still required before Window 2

The existing `.env` was preserved and provides MONGODB_URI only. Set SEED_ADMIN_LOGIN_ID, SEED_ADMIN_PASSWORD and SESSION_SECRET in your local environment. On this workstation, also set MONGODB_DNS_SERVERS to suitable reachable resolvers (1.1.1.1,8.8.8.8 was verified), or repair your system's Atlas SRV resolution. Then run `npm run db:check` and `npm run db:seed`. No admin or seed data was written to the configured database during this window; bootstrap was verified on the disposable replica set instead. Never paste real credentials into documentation or source.
