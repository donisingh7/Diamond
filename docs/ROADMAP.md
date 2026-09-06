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

## Window 2A handoff status

Window 2A (premium design system plus player/admin application shells — presentation only, no authentication) was started by a prior agent and completed in this session after that agent's usage limit ended. Implemented: the full token/typography/motion system in `src/app/globals.css` and `src/lib/ui/motion.ts`; reusable primitives under `src/components/ui/*` (Button/IconButton, Input/PasswordInput/OtpPreview, Tabs, Badge/Alert/EmptyState/ErrorState/Skeleton, Money, Countdown, NumberTile, GlassSurface/GlassCard/GlassPanel, TicketSurface/TicketSection, DataTable, Modal/BottomSheet/Drawer/ConfirmationDialog, ToastProvider); shared navigation primitives (`Brand`, `NavItem`, `ProfileMenu`); the player shell (desktop header nav, sub-1024px bottom nav) and admin shell (sidebar with collapse + tablet compact rail + mobile drawer); presentation-only `/login` and `/admin/login`; and a development-only design showcase (`/dev/design-system`, `/dev/player/[[...section]]`, `/dev/admin/[[...section]]`) gated to 404 outside `NODE_ENV=development`. See DESIGN_SYSTEM.md's "Window 2A implementation" section for the full architecture.

Inherited-state notes for future agents: the prior agent's component/CSS work was materially complete and was kept as-is; two defects were found and fixed rather than rewritten — `src/app/globals.css` had been saved with a leading UTF-8 BOM, which made Turbopack/lightningcss fail the entire production build with a misleading "Invalid dangling combinator in selector" error (fixed by re-saving without the BOM; the rest of the file was untouched), and `Button`'s prop type let Motion's `MotionValue` leak into `children`, which `tsc` rejected (fixed by typing `children` as `ReactNode` explicitly). The referenced-but-missing `src/components/dev/design-showcase.tsx` was written new in this session using the showcase CSS classes the prior agent had already prepared in `globals.css`.

Window 2B (session/OTP/login backend, protected route wiring) was intentionally not started.

## Verification record — 2026-09-06 (Window 2A)

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run lint` | PASS |
| `npm.cmd test` | PASS; 52 tests across seven files (41 Window 1 + 11 new: `countdown.test.ts`, `navigation.test.ts`, `dev-guard.test.ts`) |
| `npm.cmd run test:integration` | PASS; six tests, disposable MongoDB replica set (unaffected by this window) |
| `npm.cmd run build` | PASS; Turbopack production build succeeds after the BOM fix |
| `npm.cmd run start` then `curl` | PASS; `/`, `/login`, `/admin/login` return 200; `/dev/design-system`, `/dev/player/home`, `/dev/admin/dashboard` return 404 in production |
| `npm.cmd run dev` then `curl` | PASS; all six routes above return 200 in development; showcase HTML contains expected section markers, no error-boundary/crash markers |
| `git diff --check` | PASS; no whitespace errors |
| Browser visual QA | Not performed — no screenshot/browser tool was available in this environment. Verification was HTML-output and code-level (media query review against the 320–1440px+ target widths) only; a human/visual pass is still recommended before this is treated as pixel-final. |

No Window 2B (authentication) work was started in this session.

## Window 2B handoff status

Window 2B (authentication + server-backed sessions + mock OTP + authorization + protected routes) is complete. Implemented: password login and secondary phone+OTP login for players, password-only login for admins, server-backed sessions (hashed token, HttpOnly/SameSite=Lax/Secure-in-production cookie), server-side route protection for the player and admin areas via route groups, real logout/session revocation, and the five documented `/api/auth/*` routes. See SECURITY_AND_AUTH.md's "Window 2B implementation" and ARCHITECTURE.md's "Window 2B: auth module layout and route protection" sections for the full design; API_CONTRACTS.md records the exact request/response shapes actually implemented (including the `portal` field, a documented refinement of the original sketch).

**Window 2A's visual design (colors, glass strength, ticket appearance) is unchanged and remains pending a dedicated visual-browser refinement pass — this window only wired real functional states (loading/error/success, real logout) into the existing presentation.** A future coding agent should not mistake this window's technical completion for visual sign-off.

Inherited-state note: at the start of this session, `package.json`/`package-lock.json` had an uncommitted, unexplained addition of `@testing-library/react`, `@testing-library/user-event` and `jsdom` (fully installed in `node_modules`) that neither this window nor the prior Window 2A session had requested — Window 2A's own handoff explicitly recorded these as deliberately not installed. Its origin is unknown (not caused by any command run in this session). It was stashed rather than discarded (`git stash list` retains it) and `node_modules` was resynced to the committed lockfile; auth testing did not need a DOM. Also found: `src/components/dev/design-showcase.tsx`, committed by the user as part of a `phase-2A` commit between sessions, was missing from the working-tree filesystem for reasons unrelated to any command in this session; it was restored from git (`git restore`) with no content change.

Window 3 (Player Home + Markets + Market Timing UX + Results) was not started.

## Verification record — 2026-09-06 (Window 2B)

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run lint` | PASS |
| `npm.cmd test` | PASS; 61 tests across ten files (52 prior + 9 new pure-logic: `session-token.test.ts`, `auth-validators.test.ts`, `same-origin.test.ts`) |
| `npm.cmd run test:integration` | PASS; 31 tests across two files (6 prior foundation + 25 new in `auth.integration.ts`, all against a disposable MongoDB replica set) |
| `npm.cmd run build` | PASS; all five `/api/auth/*` routes and both protected areas registered |
| `git diff --check` | PASS; no whitespace errors |
| Manual HTTP/E2E verification | PASS — see below |

Manual verification used a second disposable local MongoDB replica set (never the user's configured `.env`/database) plus a real `next dev` process and `curl` with a cookie jar. Exercised: public `/login` and `/admin/login` (200); unauthenticated `/` and `/admin` (307 to the correct login page); unauthenticated `/api/auth/me` (401); wrong password, admin-credential-via-player-portal, player-credential-via-admin-portal and disabled-user login attempts (all rejected with the documented codes); correct player and admin logins (session cookie issued, confirmed `HttpOnly`); authenticated `/api/auth/me`; authenticated cross-role visits to `/`, `/admin`, `/login` and `/admin/login` (all redirected to the correct area, no loops); logout followed by a 401 `/me` and a redirect back to login; the full OTP request → (dev-only) code → verify → session cycle, replaying the same consumed code (rejected), and an unregistered/disabled/admin phone all producing the identical generic response; a cross-origin `Origin` header on `POST /api/auth/login` (rejected 403). All temporary QA scripts, the disposable database, and the second dev server were removed/stopped afterward.
