# Implementation roadmap

## Window 4B0 handoff — 2026-09-07

**COMPLETE: Light-First Theme System + Gaming Visual Identity.** Frontend-only work from integrated baseline `ca18433` on `codex-frontend`. Light is the true first-visit default, Dark is header-accessible and explicitly persisted locally, and an early root initializer prevents theme flashing. Shared semantic palettes retrofit all implemented surfaces with luminous gaming materials. See DESIGN_SYSTEM.md and PLAYER_UX.md for architecture and QA evidence.

Final gates passed: typecheck, lint, 232 tests across 18 files, production build and diff whitespace check. Completed 120 route/theme/viewport checks with zero overflow and clean normal-route console/hydration; persistence, pre-hydration paint, contrast and interaction checks passed. QA scratch artifacts were removed. No dependencies changed; backend/domain/API/auth/schema behavior and `claude-backend` were untouched.

Window 4B betting functionality has **not** started. Next frontend work is the separately requested Window 4B1 betting-entry window. Do not start it, later Wallet/My Bets features or Admin operations automatically. Integration/push remains the human's responsibility after the parallel backend window is audited.

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

## Window 3A handoff status

Window 3A (Markets + daily MarketRounds + server-authoritative IST scheduling + cross-midnight handling + current-round resolution + betting-window helper + result **read** services + player market/results APIs) is complete. Backend/domain only. See ARCHITECTURE.md's "Window 3A" section for the full design, DATABASE.md's "Window 3A — index review" for the one added index, and API_CONTRACTS.md's "Window 3A — implemented Player market & results contract" for exact request/response shapes.

Implemented:

- `lib/dates/market-time.ts`: added `getBettingWindow(enabled, round|null, now) → {canPlaceBet, canEditBet, reason?}` and the `MarketLifecycleState`/`BettingWindow` types. The Window 1 functions (`getRoundTimes`, `resolveMarketBusinessDate`, `deriveMarketStatus`, `isBetPlacement/EditAllowed`) are unchanged; the equality-boundary semantics they froze (`[opensAt, closesAt)` placement, `now < editCutoffAt` edit, `CLOSING_SOON` = edit-locked interval) are re-asserted by new tests, not modified.
- `modules/markets/services/market.service.ts`: `ensureMarketRound` (idempotent create-or-get, snapshots schedule at creation, unique-index race backstop), `resolveCurrentRound` / `resolveCurrentRoundsForMarkets` (canonical current-round selection incl. Disawar cross-midnight), `getMarketBySlug`, `listMarkets` / `listEnabledMarkets`, `getMarket(s)WithCurrentRound(s)`.
- `modules/markets/services/result.service.ts`: `getCurrentResults` (today = each market's operational round), `getResultHistory` (`7d`/`30d`, optional market filter, persisted result-bearing rounds only, inclusive IST window capped at today), `historyWindow`.
- `modules/markets/services/market-dto.ts`: `toMarketDTO` — the only market/round shape sent to a browser (ISO instants, `YYYY-MM-DD` business date, 2-char result string, no admin/Mongo internals).
- `modules/markets/validators/market-query.ts`: Zod `marketSlugSchema`, `resultRangeSchema`, `.strict()` `resultsQuerySchema`.
- Routes: `GET /api/markets`, `GET /api/markets/[slug]`, `GET /api/results` — thin, `requirePlayer()`-gated, `apiRoute`-wrapped, `serverNow` in every response. `apiRoute` is now variadic so it forwards Next's route context to the dynamic-segment handler.
- `lib/errors/domain-error.ts`: added `MARKET_NOT_FOUND` (404), `MARKET_NOT_OPEN` (422), `ROUND_NOT_FOUND` (404), `INVALID_RESULT_RANGE` (400).
- `marketRounds`: added index `{ businessDate: 1, marketId: 1 }` for cross-market history. Model document shapes unchanged; added `InferSchemaType` type exports.

Deliberately **not** done (out of window): any player Home / market-card / Results visual UI (the `/` placeholder is untouched), Jodi/Crossing/Copy-Paste/Palti, bet quote/placement/editing, wallet/deposit/withdrawal, admin CRUD, admin result declaration, settlement/payout, sports/casino, real-time sockets, cron infrastructure. No result-mutation endpoint was added — result fixtures used in tests are direct `MarketRound` inserts, not a public API.

**Window 2A's visual design (colors, glass strength, ticket appearance) remains pending a dedicated Codex visual refinement pass. This window built no UI and did not attempt any Window 2A visual redesign.** A future agent should not read this window's completion as visual sign-off.

Window 3's visual scope (Player Home, market cards, market timing UX, Results page) is **not** started — a later Codex visual window consumes these APIs/services.

## Verification record — 2026-09-06 (Window 3A)

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS; strict TypeScript incl. new routes/services/tests |
| `npm.cmd run lint` | PASS |
| `npm.cmd test` | PASS; 84 tests across 11 files (61 prior + 23 new in `market-window.test.ts`) |
| `npm.cmd run test:integration` | PASS; 50 tests across 3 files (31 prior + 19 new in `markets.integration.ts`) against a disposable MongoDB 8.2.6 replica set |
| `npm.cmd run build` | PASS; `/api/markets`, `/api/markets/[slug]`, `/api/results` registered as dynamic route handlers |
| `git diff --check` | PASS; no whitespace errors |
| Manual HTTP/E2E verification | PASS — see below |

New unit coverage (`market-window.test.ts`): Faridabad `06:59:59→UPCOMING`, `07:00:00→OPEN`, `16:49:59→editable`, `16:50:00→edit-locked/CLOSING_SOON/bets-still-open`, `17:49:59→bets-open`, `17:50:00→closed/RESULT_PENDING`; exact close instants for Delhi Bazar (15:00), Gali (23:10), Shree Ganesh (16:40), Ghaziabad (21:00); full Disawar cross-midnight sequence Sep 6 06:59 → Sep 7 07:00 including `02:00` edit-lock, `02:59:59` bets-open, `03:00` close, and `resolveMarketBusinessDate` flipping to the new date at exactly `03:00`; disabled/no-round/resulted/settled gates.

New integration coverage (`markets.integration.ts`): round snapshot correctness; idempotent rerun; unique `(marketId, businessDate)` rejection; schedule change leaves historical round unchanged but new date uses new schedule; Disawar close lands on the next calendar day with a 60-minute cutoff; 8-way concurrent `ensureMarketRound` creates exactly one; `resolveCurrentRound` before/during/after same-day close, Disawar 01:30 (previous date) and 03:30 (new date, previous still queryable); disabled market → no persisted round + DISABLED; batched resolution creates 6 rounds once then reuses; `historyWindow` IST maths incl. a UTC-boundary case; `getCurrentResults` pending-as-null and declared-result-with-leading-zero (`"07"`), no `declaredByAdminId` in the DTO; `getResultHistory` window bounding (excludes 8-day-old and future-dated rounds), result-bearing-only filter, market filter, newest-first ordering, unknown-slug `MARKET_NOT_FOUND`; `getMarketBySlug` casing normalisation + 404.

Manual HTTP verification used a **disposable** `mongodb-memory-server-core` replica set (seeded with the six markets, one ACTIVE player, one ACTIVE admin) plus a real `next dev` on port 3517 — the user's configured `.env`/database was never touched. Exercised and observed: unauthenticated `GET /api/markets` → 401; player password login → 200 + session cookie; authenticated `GET /api/markets` → 200 with 6 sanitised markets, each with a resolved round, plus `serverNow`; `GET /api/markets/faridabad` → 200; `GET /api/markets/not-a-market` → 404 `MARKET_NOT_FOUND`; `GET /api/results?range=today` → 200 with 6 entries, `?range=7d` and `?range=30d` → 200; `?range=today&market=faridabad` → 200 single entry; `?range=all-time` and `?range=today&foo=bar` → 400 `INVALID_INPUT`; `?range=7d&market=ghost` → 404 `MARKET_NOT_FOUND`; admin password login → 200, then admin session against `GET /api/markets` and `GET /api/results` → 403 (PLAYER-only boundary preserved). The dev server, the disposable database and all cookie jars/scripts were stopped and removed afterward.

No live `npm run db:check` / `npm run db:seed` against the user's configured database was run in this window; all database verification used disposable replica sets.

## Window 4A1 handoff status

Window 4A1 (Jodi + Crossing + Copy Paste + Palti engines + canonical selection normalization + bet quote) is complete. **Backend / domain only.** See ARCHITECTURE.md's "Window 4A1" section for the design, DOMAIN_RULES.md's "Window 4A1 implementation clarification" for the frozen-rule mapping, API_CONTRACTS.md's "Window 4A1 — implemented bet quote contract" for exact shapes, and DATABASE.md's "Window 4A1 — no schema change".

Implemented:

- `modules/betting/engines/` — pure, no `server-only` marker (environment-agnostic, reusable by quote / future placement / future edit / tests): `selection.ts` (canonical two-char helpers, order-preserving dedupe, `reverseTwoDigit`), `jodi.engine.ts` (`normalizeJodi`), `crossing.engine.ts` (`generateCrossing` → `{uniqueDigits, uniqueDigitCount, numbers}`), `copy-paste.engine.ts` (`parseCopyPaste`, fail-closed), `palti.engine.ts` (`expandPalti`), `normalize.ts` (`normalizeBetEntry` → `NormalizedBetEntry`, the single normalization entry point), `types.ts`. `contracts.ts`'s `NormalizeBet` return type widened from `readonly NormalizedSelection[]` to `NormalizedBetEntry`.
- `modules/settings/services/platform-settings.service.ts` — `getPlatformSettings()` read-only accessor. No mutation API; seed default rate (90) unchanged.
- `modules/betting/validators/quote-input.ts` — `quoteRequestSchema` (Zod discriminated union on `entryMethod`, every branch `.strict()`), `toEntryInput()`.
- `modules/betting/services/quote.service.ts` — `quoteBet(request, now)` → `BetQuote`. Reads `platformSettings` + `markets`, resolves the current round via the Window 3A helper, gates on `getBettingWindow(...).canPlaceBet`. Reads no wallet; writes no bet / wallet / ledger document.
- `src/app/api/bets/quote/route.ts` — `POST` (ACTIVE PLAYER, same-origin, thin, `force-dynamic`).

Deliberately **not** done (out of window): actual `Bet.create`, `clientRequestId` persistence, public bet reference generation, wallet read/debit, wallet ledger, bet revisions, bet editing, confirmation ticket flow, PNG/PDF tickets, bet slip, any betting/market/Home UI, withdrawals, settlement, admin features, admin result declaration. No monetary state is mutated in this window. No new error codes, collections or indexes were added.

**Window 2A's visual design remains pending a dedicated Codex visual refinement pass. This window built no UI and attempted no Window 2A visual redesign.** A future agent must not read this window's completion as visual sign-off.

Remaining Window 4 scope (bet slip UI, premium ticket, `POST /api/bets` placement + wallet debit + ledger, `PATCH /api/bets/:id` editing, `betRevisions`, My Bets) is **not** started.

## Verification record — 2026-09-06 (Window 4A1)

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS; strict TypeScript incl. new engines/services/validators/route/tests |
| `npm.cmd run lint` | PASS |
| `npm.cmd test` | PASS; 134 tests across 12 files (84 prior + 50 new in `bet-engines.test.ts`) |
| `npm.cmd run test:integration` | PASS; 64 tests across 4 files (50 prior + 14 new in `bets.integration.ts`) against a disposable MongoDB 8.2.6 replica set |
| `npm.cmd run build` | PASS; `/api/bets/quote` registered as a dynamic route handler |
| `git diff --check` | PASS; no whitespace errors |
| Manual HTTP/E2E verification | PASS — see below |

New unit coverage (`bet-engines.test.ts`): Jodi `["00"]`/`["07"]` preserved, multi-value normalize, duplicate collapse (no double charge), invalid values `"7"`/`"100"`/`"-1"`/`"ab"`/`"1.0"`/`" 7"` rejected, empty list rejected, ₹1 (100 paise) accepted / 99 rejected (`STAKE_BELOW_MINIMUM`), `MAX_SAFE_INTEGER` stake × 2 selections rejected (`MONEY_OUT_OF_RANGE`); Crossing `428935` → 6 unique → 36 unique selections with self-pairs and ordered pairs, `428` exact deterministic order `44 42 48 24 22 28 84 82 88`, `4428` → unique `4,2,8` → 9, `012` → leading-zero-preserving `00 01 02 10 11 12 20 21 22`, `0123456789` → exactly 100, non-digit input rejected; Copy Paste `2215489635` → `22 15 48 96 35`, space/comma/dot/mixed separators equivalent, leading zeros `00 07 10`, duplicates kept at parse time, fail-closed on `"1"`/`"123"`/`"22,1,48"`/`"ab22"`/`""`/`"22-15"`/`"2,,,"`; Palti exact `22 15 48 96 35` → `22 15 51 48 84 96 69 35 53`, `22`→`22`, `00`→`00`, `07`→`07 70`, `10`→`10 01`, global dedupe `12 21`→`12 21`; `normalizeBetEntry` Crossing 6-unique @ ₹10 → 36 selections / ₹360 total / ₹10 each and `engineMetadata`.

New integration coverage (`bets.integration.ts`): 3 JODI @ ₹10 → ₹30 total, ₹900 per-winning-selection credit at 90x, `currency: "INR"`, `binding: false`; CROSSING `428935` @ ₹10 → 36 selections / ₹360; COPY_PASTE palti → frozen 9-number sequence + `{rawInput, palti:true}` metadata; `marketRoundId` + `businessDate` match the persisted round; stake 99 → `STAKE_BELOW_MINIMUM`; **payout multiplier config-driven** — `platformSettings.payoutMultiplier` set 90→95 in the test makes the quote return 95 / ₹950 with no code change; market window with a fixed clock — before open → `MARKET_NOT_OPEN`, exactly at open → allowed (`OPEN`), during `CLOSING_SOON` → allowed with `editableAfterPlacing: false`, exactly at close → `MARKET_CLOSED`, disabled market → `MARKET_DISABLED`, unknown slug → `MARKET_NOT_FOUND`; **no financial writes** — `bets` / `wallets` / `walletTransactions` counts are `0` before and after a successful quote; non-binding — a repeated identical quote returns an equivalent result.

Manual HTTP verification used a **disposable** `mongodb-memory-server-core` replica set (seeded with the six markets, one ACTIVE player, one ACTIVE admin) plus a real `next dev` on port 3799 — the user's configured `.env`/database was never touched. The temporary driver script lived under `scratchpad/` and was deleted afterward. Exercised and observed: unauthenticated `POST /api/bets/quote` → 401; player password login → 200 + `diamond_session` cookie; `GET /api/markets` to pick a market open at real wall-clock time (Ghaziabad); authenticated `POST /api/bets/quote` for JODI (→ 200, `selectionCount 3`, `totalStakePaise 3000`, `perWinningSelectionCreditPaise 90000`, `payoutMultiplier 90`, `binding:false`, string `marketRoundId`), CROSSING `428935` (→ 200, 36 selections, `totalStakePaise 36000`), COPY_PASTE without Palti (→ `22,15,48,96,35`) and with Palti (→ `22,15,51,48,84,96,69,35,53`); a malformed number `["7"]` → 400; an irrelevant cross-method field (`digits` on a JODI body) → 400; a mismatched `Origin` header → 403; a market disabled mid-run → 422 `MARKET_DISABLED` (restored after); an ADMIN session → 403; and `bets` / `wallets` / `walletTransactions` all still empty at the end. The dev server, the disposable database and the temporary script were stopped and removed afterward.

No live `npm run db:check` / `npm run db:seed` against the user's configured database was run in this window; all database verification used disposable replica sets. Window 2A visual quality remains pending Codex visual-browser refinement.

## Window 4A2 handoff status

Window 4A2 (wallet core + immutable ledger + transaction-safe balance movement + Mock Deposit
+ player wallet read APIs) is complete. **Backend / financial domain only.** See
ARCHITECTURE.md's "Window 4A2" section for the design, DOMAIN_RULES.md's "Window 4A2
implementation clarification" for the frozen-rule mapping, API_CONTRACTS.md's "Window 4A2 —
implemented player wallet contract" for exact shapes, and DATABASE.md's "Window 4A2 — wallet
core: no wallet schema change".

Implemented:

- `modules/wallet/services/wallet.service.ts` — the sole `wallets` balance writer.
  `applyWalletMovement(input, session)` transaction-scoped primitive (frozen `movementDeltas`
  table, conditional `findOneAndUpdate` guard, idempotency pre-check + unique-index backstop,
  atomic `walletTransactions` insert). Named wrappers `creditAvailableInSession`,
  `debitAvailableInSession`, `reserveInSession`, `releaseReservedInSession`,
  `finalizeReservedInSession`. `createPlayerWallet` (idempotent ₹0), `getWalletDoc`,
  `getWalletView`, `toWalletView`, `getTransactionByIdempotencyKey`.
- `modules/wallet/services/mock-deposit.service.ts` — `mockDeposit(...)`, owns its
  `withTransaction`, deterministic `MOCK_DEPOSIT:<userId>:<clientRequestId>` key, E11000
  recovery outside the aborted transaction.
- `modules/wallet/services/wallet-transactions.service.ts` — `listWalletTransactions` bounded
  cursor pagination (default 20, max 100, newest first), player-safe `WalletTransactionDTO`.
- `modules/wallet/validators/wallet-input.ts` — `mockDepositSchema`,
  `walletTransactionsQuerySchema` (both `.strict()`).
- Routes: `GET /api/wallet`, `POST /api/wallet/mock-deposit`, `GET /api/wallet/transactions` —
  thin, `requirePlayer()`-gated, `apiRoute`-wrapped, `force-dynamic`; the POST also same-origin.
- `lib/errors/domain-error.ts` — added `WALLET_NOT_FOUND` (404), `INVALID_AMOUNT` (422).
- Type-only exports added to `wallet.model.ts` / `wallet-transaction.model.ts`. No schema,
  validator, hook or index changed. `wallet.service.ts` supersedes and replaces the deleted
  Window 1 `wallet.contract.ts` sketch.

Deliberately **not** done (out of window): `Bet.create`, public bet refs, bet placement/edit
endpoints, `BetRevision`, `withdrawals` documents/APIs, admin wallet adjustment API/UI, result
settlement, real payment gateway / Razorpay / UPI, any wallet or ticket UI, any Window 2A
visual redesign. The reserve/release/finalize and `BET_*` / `WIN_CREDIT` / `ADMIN_*`
primitives exist and are tested, but none of their higher-level workflows were built.

**Window 2A's visual design (colors, glass strength, ticket appearance) remains pending a
dedicated Codex visual-browser refinement pass. This window built no UI and attempted no
Window 2A visual redesign.** A future agent must not read this window's completion as visual
sign-off.

## Verification record — 2026-09-06 (Window 4A2)

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS; strict TypeScript incl. new services/validators/routes/tests |
| `npm.cmd run lint` | PASS; no warnings |
| `npm.cmd test` | PASS; 163 tests across 13 files (134 prior + 29 new in `wallet.test.ts`) |
| `npm.cmd run test:integration` | PASS; 92 tests across 5 files (64 prior + 28 new in `wallet.integration.ts`) against a disposable MongoDB 8.2.6 replica set |
| `npm.cmd run build` | PASS; `/api/wallet`, `/api/wallet/mock-deposit`, `/api/wallet/transactions` registered as dynamic route handlers |
| `git diff --check` | PASS; no whitespace errors |
| Manual HTTP/E2E verification | PASS — see below |

New unit coverage (`wallet.test.ts`): the frozen `movementDeltas` table for all ten ledger
types (+ value-conservation invariant); `assertMovementAmount` / `assertMockDepositAmount`
(₹1 min, no max, `INVALID_AMOUNT` below, `MONEY_OUT_OF_RANGE` on fractional / unsafe);
`buildMockDepositKey` determinism (user + op + requestId, never the amount); `toWalletView`
total derivation; `toWalletTransactionDTO` field allowlist (no `idempotencyKey` /
`createdByAdminId` / `walletId` / `userId`); pagination-limit clamp `[1,100]` default 20;
opaque cursor round-trip + malformed-cursor `INVALID_INPUT`; `isDuplicateKeyError`;
`mockDepositSchema` / `walletTransactionsQuerySchema` accept/reject cases.

New integration coverage (`wallet.integration.ts`): `createPlayerWallet` idempotent + single
under 8-way concurrency; `WALLET_NOT_FOUND` when absent; **concurrency §30** — available
`10000`, two concurrent `8000` debits → one succeeds / one `INSUFFICIENT_BALANCE` / final
`2000` / one ledger row / never negative (+ 6-racer `4000`-debit → exactly `2000`, two rows);
**idempotency §31** — duplicate Mock Deposit credits once with one `MOCK_DEPOSIT` row; reused
`clientRequestId` + different amount → `DUPLICATE_REQUEST`, no second movement; two concurrent
identical deposits → one credit; `applyWalletMovement` replays a committed key with
`idempotentReplay: true` and no mutation; **reserve/release/finalize §32** — exact
before/after/delta on every transition, guards reject over-reserve / over-release /
over-finalize, reserved funds not debitable; **bet-type primitives §33** — `BET_PLACED` /
`BET_EDIT_DEBIT` / `BET_EDIT_REFUND` / `WIN_CREDIT` directions; **admin-type primitives §34** —
`ADMIN_CREDIT` / `ADMIN_DEBIT`, debit cannot go negative, `createdByAdminId` recorded;
**rollback §35** — a movement inside a caller `withTransaction` that then throws leaves the
balance unchanged and writes no ledger row; a caller combining two primitives commits both
atomically; **Mock Deposit §13/§36** — ₹1 accepted, ₹5cr accepted (no max), 99 paise /
fractional / negative / unsafe rejected, `mockDepositEnabled:false` → `FORBIDDEN`, correct
`MOCK_DEPOSIT` ledger row; **reads §16/§17/§37** — `getWalletView` derives total and
lazy-creates ₹0; ledger newest-first, default limit 20, explicit limit honoured, capped at
data size, never another player's rows, malformed cursor `INVALID_INPUT`, DTO carries full
before/after/delta and no internal metadata; **scope guard §39/§40** — a full wallet exercise
writes no `bets` / `betRevisions` / `withdrawals` document.

Manual HTTP verification used a **disposable** `mongodb-memory-server-core` replica set
(seeded with the six markets, one ACTIVE player, one ACTIVE admin) plus a real `next dev` on
port 3941 — the user's configured `.env`/database was never touched. The temporary driver
script lived under `scratchpad/` and was deleted afterward. Exercised and observed: `GET
/api/wallet` unauthenticated → 401; player login → 200 + `diamond_session` cookie; `GET
/api/wallet` (player) → 200 `₹0` wallet with derived `totalBalancePaise: 0`; `POST
/api/wallet/mock-deposit {amountPaise:10000, clientRequestId:<uuid>}` → 200, transaction +
`availableBalancePaise: 10000`; `GET /api/wallet` → `10000`; the same `clientRequestId`
replayed → 200, same `transaction.id`, still `10000`; the same `clientRequestId` with
`amountPaise:20000` → 409 `DUPLICATE_REQUEST`; `GET /api/wallet/transactions` → exactly one
`MOCK_DEPOSIT` row, no `idempotencyKey` field; a mismatched `Origin` on the deposit → 403; a
99-paise deposit → 422 `INVALID_AMOUNT`; an ADMIN session against all three wallet routes →
403; and `bets` / `withdrawals` empty with exactly one `wallets` doc and one
`walletTransactions` row at the end. The dev server, the disposable database and the temporary
script were stopped and removed afterward.

No live `npm run db:check` / `npm run db:seed` against the user's configured database was run
in this window; all database verification used disposable replica sets. Window 2A visual
quality remains pending Codex visual-browser refinement.

## Window 4A3 handoff status

Window 4A3 (real player bet placement — canonical wager recompute + market revalidation +
payout-multiplier snapshot + `Bet` persistence + atomic wallet debit + immutable `BET_PLACED`
ledger + client-request idempotency + human public reference + `POST /api/bets`) is complete.
**Backend / financial domain only.** See ARCHITECTURE.md's "Window 4A3" section for the design,
DOMAIN_RULES.md's "Window 4A3 implementation clarification" for the frozen-rule mapping,
API_CONTRACTS.md's "Window 4A3 — implemented bet placement contract" for exact shapes, and
DATABASE.md's "Window 4A3 — bet placement: no schema or index change".

Implemented:

- `modules/betting/services/bet-placement.service.ts` — `placeBet(input, options?)`. Recomputes
  `selections` / `entryMetadata` / totals through the shared `normalizeBetEntry` engine (never
  a quote); existing-success idempotency recovery **before** the market-close re-check;
  `resolveCurrentRound` + `getBettingWindow` gate, re-checked inside the transaction against a
  fresh injectable clock; one `withTransaction` doing the payout-multiplier snapshot read →
  `debitAvailableInSession("BET_PLACED", key BET_PLACED:<betId>)` → free-`publicRef` pick →
  native-driver `Bet` insert; lost `(userId, clientRequestId)` race recovered outside the
  aborted transaction. `betMatchesRequest` canonical-wager comparison. `BetPlacementReceipt` DTO.
- `modules/betting/services/public-ref.ts` — `generatePublicRef` (`<CODE>-<MMDD>-<5 random>`
  over a 31-symbol Crockford-style alphabet, `crypto.randomInt`), `businessDateRefComponent`,
  `PUBLIC_REF_MAX_ATTEMPTS`.
- `modules/betting/validators/place-bet-input.ts` — `placeBetRequestSchema` (Zod discriminated
  union on `entryMethod`, every branch `.strict()`, `clientRequestId: z.uuid()`),
  `toPlaceEntryInput`. Same field names as `quoteRequestSchema`.
- `src/app/api/bets/route.ts` — `POST` (ACTIVE PLAYER, same-origin, thin, `force-dynamic`).
- `modules/betting/models/bet.model.ts` — `BetRecord` / `BetDoc` type-only exports (no schema
  or index change). `modules/settings/services/platform-settings.service.ts` —
  `getPlatformSettings(session?)` optional `ClientSession` (backward-compatible).

Deliberately **not** done (out of window): `PATCH /api/bets/:id` and any bet editing,
`BetRevision.create` and `BET_EDIT_DEBIT` / `BET_EDIT_REFUND` movements, My Bets / bet-slip /
premium-ticket UI, PNG/PDF or any stored ticket file, `GET /api/bets` / `GET /api/bets/:id`,
wallet UI, withdrawal workflow, admin CRUD, result declaration, settlement / `WIN_CREDIT` /
payout credit, any Window 2A visual redesign. `betRevisions`, `withdrawals` and settlement
collections are untouched. No new error codes, collections or indexes were added.

**Window 2A's visual design (colors, glass strength, ticket appearance) remains pending a
dedicated Codex visual-browser refinement pass. This window built no UI and attempted no
Window 2A visual redesign.** A future agent must not read this window's completion as visual
sign-off. Remaining Window 4 scope (bet slip UI, premium ticket, bet editing + `betRevisions`,
My Bets) is **not** started.

## Verification record — 2026-09-06 (Window 4A3)

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS; strict TypeScript incl. new service/validator/route/tests |
| `npm run lint` | PASS; no warnings |
| `npm test` | PASS; 173 tests across 14 files (163 prior + 10 new in `bet-placement.test.ts`) |
| `npm run test:integration` | PASS; 117 tests across 6 files (92 prior + 25 new in `bet-placement.integration.ts`) against a disposable MongoDB 8.2.6 replica set |
| `npm run build` | PASS; `/api/bets` registered as a dynamic route handler |
| `git diff --check` | PASS; no whitespace errors |
| Manual HTTP/E2E verification | PASS — see below |

New unit coverage (`bet-placement.test.ts`): `generatePublicRef` format
`^FB-0906-[A-Z2-9 minus IO]{5}$`, market code upper-cased, ambiguous glyphs `I O 0 1` absent
from 500 suffixes, `businessDateRefComponent` MMDD extraction, ~zero duplicates across 5000
generations; `betMatchesRequest` — identical wager matches, `"22 15 48"` vs `"22,15,48"`
COPY_PASTE normalize-equal, different stake / market / selection count / Palti expansion do not
match; `placeBetRequestSchema` — accepts each method with a UUID `clientRequestId`, rejects a
missing / non-UUID id and every client-supplied authoritative or cross-method field
(`totalStakePaise`, `selectionCount`, `selections`, `payoutMultiplier`, `marketRoundId`,
`publicRef`, `digits` on JODI).

New integration coverage (`bet-placement.integration.ts`, fixed injected clock): **success** —
JODI `["07","22","48"]` @₹10 → ACTIVE v1 bet, `FB-0906-*` publicRef, exact ordered selections,
`totalSelections 3` / `totalStakePaise 3000` / `payoutMultiplierSnapshot 90`,
`marketRoundId` = the resolved round, `placedAt`/`serverNow` = the injected clock, receipt
carries no `clientRequestId` / `marketId` / `marketRoundId` / `userId`; CROSSING `4428` → 9
canonical selections, debit = 9 × stake; COPY_PASTE `2215489635` palti → exact 9-number
shared-engine sequence; leading-zero `["00","07"]` persisted and returned as strings.
**wallet** — exact debit, one `BET_PLACED` ledger row with `referenceType:"BET"`,
`referenceId = bet._id`, `idempotencyKey = BET_PLACED:<betId>`; reserved balance untouched
(success and rejection). **multiplier snapshot** — rate 90 → snapshot 90; rate set 95 → next
bet snapshot 95; rate set 80 → both persisted bets keep 90 / 95. **idempotency** — same
request retried → same `bet.id` + `publicRef`, no second debit / ledger row; `"22 15 48"` then
`"22,15,48"` under one `clientRequestId` → same bet; same id + different numbers →
`DUPLICATE_REQUEST`, no second bet or debit; two concurrent identical requests → one bet / one
debit / one ledger row, both callers get the same id; replay after close → original bet
returned (`canEditNow:false`), a *new* id after close → `MARKET_CLOSED`. **concurrency** — two
different ₹80 bets against ₹100, different ids → one success / one `INSUFFICIENT_BALANCE` /
final available ₹20 / one bet / one ledger. **boundaries** — before open → `MARKET_NOT_OPEN`;
exactly at open → allowed; `CLOSING_SOON` → placed, `canEditNow:false`, still v1 ACTIVE;
exactly at close → `MARKET_CLOSED`; disabled market → `MARKET_DISABLED`; a close that lands
between the pre-check and the transaction (advancing clock) → `MARKET_CLOSED` at the
transactional boundary — every rejection leaves zero `bets` / `BET_PLACED` rows and the wallet
unchanged. **atomicity** — insufficient available balance → `INSUFFICIENT_BALANCE`, no partial
write; reserved funds cannot cover a bet; a forced public-reference-generator throw *after* the
wallet debit → whole transaction rolls back (balance restored, no ledger row, no bet); a rare
`publicRef` collision recovered by bounded retry (2 collisions then a fresh ref → placed with a
different ref, 2 bets); a persistent collision fails with no partial write. **scope guard** —
after two placements, `betRevisions` / `withdrawals` count 0, no `WIN_CREDIT` /
`BET_EDIT_*` rows, no round left non-`PENDING`.

Manual HTTP verification used a **disposable** `mongodb-memory-server-core` replica set (seeded
with the six markets, one ACTIVE player, one ACTIVE admin) plus a real `next dev` — the user's
configured `.env`/database was never touched; the temporary driver script lived under
`scratchpad/` and was deleted afterward. Exercised and observed: unauthenticated
`POST /api/bets` → `401`; player password login → `200` + `diamond_session` cookie; a
`mock-deposit` to fund the wallet; `POST /api/bets` JODI → `200` with a `FB-*` publicRef, wallet
`availableBalancePaise` reduced by the stake, `GET /api/wallet/transactions` containing exactly
one `BET_PLACED` row; the same `clientRequestId` replayed → `200`, identical `publicRef`, no
second debit; the same `clientRequestId` with different numbers → `409 DUPLICATE_REQUEST`;
CROSSING and COPY_PASTE + Palti placements → `200`; a mismatched `Origin` → `403`; an ADMIN
session → `403`; and `betRevisions` / `withdrawals` empty at the end. The dev server, the
disposable database and the temporary script were stopped and removed afterward.

No live `npm run db:check` / `npm run db:seed` against the user's configured database was run
in this window; all database verification used disposable replica sets. Window 2A visual
quality remains pending Codex visual-browser refinement.

## Window 4A4 handoff status

Window 4A4 (bet editing + immutable bet revisions + the player My-Bets **read** backend) is
complete. **Backend / financial domain only.** See ARCHITECTURE.md's "Window 4A4" section for
the design, DOMAIN_RULES.md's "Window 4A4 implementation clarification" for the frozen-rule
mapping, API_CONTRACTS.md's "Window 4A4 - implemented player bet read & edit contract" for exact
shapes, and DATABASE.md's "Window 4A4 - bet editing & reads: no schema or index change".

Implemented:

- `modules/betting/services/bet-edit.service.ts` - `editBet(input, options?)`. Whole-wager
  replacement of an ACTIVE bet through the **shared** `normalizeBetEntry` engine (never a second
  parser); same-identity (`_id` / `publicRef` / `userId` / `marketId` / `marketRoundId` /
  `placedAt` / `payoutMultiplierSnapshot` preserved, only `version` advances); `editRequestId`
  idempotent-replay recovery **before** the cutoff re-check; `getBettingWindow(...).canEditBet`
  gate for the bet's own round, re-checked inside the transaction against a fresh injectable
  clock; one `withTransaction` doing the difference-only wallet movement
  (`BET_EDIT_DEBIT` / `BET_EDIT_REFUND` / nothing) -> native compare-and-set `Bet.updateOne`
  (`version`/`status` filter, `matchedCount 0` => `STALE_VERSION`) -> native `betRevisions`
  insert; lost `(betId, toVersion)` / `(userId, editRequestId)` races recovered outside the
  aborted transaction. `betEditWalletKey`, `compositionMatchesNormalized` helpers.
- `modules/betting/services/bet-read.service.ts` - `listPlayerBets` (own bets, newest first,
  bounded `limit` 1-50 default 20, opaque `(createdAt, _id)` cursor, optional `status` /
  `market` filters, markets + rounds batch-loaded), `getPlayerBetDetail` (adds full
  `revisions[]`, oldest first), `resolveOwnedBet` / `ownedBetFilter` (24-hex `id` handle OR
  `publicRef`, always AND `userId`; `BET_NOT_FOUND` for missing OR non-owned - indistinguishable),
  `toPlayerBetDTO` / `toBetRevisionDTO` / `entryMetadataOf`, `encodeBetCursor` / `decodeBetCursor`
  / `clampBetListLimit`.
- `modules/betting/validators/edit-bet-input.ts` - `editBetRequestSchema` (Zod discriminated
  union on `entryMethod`, every branch `.strict()`, `expectedVersion: int>=1`,
  `editRequestId: z.uuid()`, NO `marketSlug`), `toEditEntryInput`. Same method-input field names
  as `quoteRequestSchema` / `placeBetRequestSchema`.
- `modules/betting/validators/bet-query.ts` - `betsListQuerySchema` (`.strict()`: `limit`
  coerced 1-50 default 20, `cursor`, `status?`, `market?`).
- `src/app/api/bets/route.ts` - `GET` added alongside the existing `POST`.
  `src/app/api/bets/[id]/route.ts` - `GET` + `PATCH` (ACTIVE PLAYER; `PATCH` same-origin;
  `force-dynamic`; no `userId` from the client).
- `lib/errors/domain-error.ts` - added `BET_NOT_FOUND` (404), `STALE_VERSION` (409).
- Type-only model additions: `bet.model.ts` `BetRow`; `bet-revision.model.ts`
  `BetRevisionRecord` / `BetRevisionDoc` / `BetRevisionRow`. No schema, validator, hook or
  index changed anywhere.

Deliberately **not** done (out of window): any My Bets / bet-slip / premium-ticket / edit UI,
PNG/PDF or stored ticket files, withdrawal workflow, admin CRUD, admin bet/revision views,
result declaration, settlement / `WIN_CREDIT` / payout credit, any Window 2A visual redesign.
`withdrawals` and settlement collections are untouched. The multiplier is never refreshed on an
edit. No sequencing was jumped beyond pulling the **My-Bets read backend** (no UI) into this
window - the roadmap lists "My Bets" under Window 5, but the edit screen and the Window 5 UI
both need these reads and Window 4A3's handoff already earmarked them.

**Window 2A's visual design (colors, glass strength, ticket appearance) remains pending a
dedicated Codex visual-browser refinement pass. This window built no UI and attempted no
Window 2A visual redesign.** A future agent must not read this window's completion as visual
sign-off. Remaining Window 4 scope is now UI only (bet slip, premium ticket, My Bets, edit
screen); the backend for "Complete Betting Engine + Jodi + Crossing + Copy Paste + Palti + Bet
Editing + Bet Revisions" is complete.

## Verification record - 2026-09-06 (Window 4A4)

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS; strict TypeScript incl. new services / validators / routes / tests |
| `npm.cmd run lint` | PASS; no warnings |
| `npm.cmd test` | PASS; 190 tests across 15 files (173 prior + 17 new in `bet-edit.test.ts`) |
| `npm.cmd run test:integration` | PASS; 145 tests across 7 files (117 prior + 28 new in `bet-edit.integration.ts`) against a disposable MongoDB 8.2.6 replica set |
| `npm.cmd run build` | PASS; `/api/bets` now GET+POST, `/api/bets/[id]` registered as a dynamic route handler |
| `git diff --check` | PASS; no whitespace errors (LF->CRLF advisories only, matching repo convention) |
| Manual HTTP/E2E verification | PASS - see below |

New unit coverage (`bet-edit.test.ts`): `editBetRequestSchema` accepts each method with
`expectedVersion` + `editRequestId`, rejects a missing / `0` / fractional `expectedVersion`, a
missing / non-UUID `editRequestId`, and every `.strict()` violation (`marketSlug`,
`clientRequestId`, `totalStakePaise`, `version`, cross-method `digits`, `userId`);
`toEditEntryInput` per branch; `betsListQuerySchema` default 20 / range `[1,50]` / rejected
stray param / accepted `status` + `market` (slug-normalised); `betEditWalletKey` determinism +
shape; `compositionMatchesNormalized` true for the same canonical wager, false on order / stake
/ method difference; `clampBetListLimit` (`undefined`->20, floor 1, cap 50, truncate); bet
cursor `(createdAt, _id)` round-trip + malformed -> `INVALID_INPUT`; `ownedBetFilter` (`_id` for
a 24-hex handle, upper-cased `publicRef` otherwise); `entryMetadataOf` by-method shape with no
cross-method key leakage; `toBetRevisionDTO` field allow-list (exactly `after` / `before` /
`editedAt` / `fromVersion` / `toVersion` / `walletDeltaPaise`); `toPlayerBetDTO` `canEditNow`
true before cutoff / false at cutoff / false for a non-ACTIVE bet, outcome fields `null`, no
internal foreign keys.

New integration coverage (`bet-edit.integration.ts`, fixed injected clock): **reads** - a
player lists only their own bets; bounded newest-first cursor pagination walks the whole
history with no gaps or repeats; `status` filter; detail resolves by `id` handle **or**
`publicRef` for the owner and is `BET_NOT_FOUND` for anyone else by either key. **edit success
/ composition** - JODI add-a-selection v1->v2 with `id` / `publicRef` / `placedAt` /
`marketRoundId` / `clientRequestId` preserved, `lastEditedAt` set, one revision (`fromVersion 1`
/ `toVersion 2` / `before` `after` snapshots / `walletDeltaPaise -1000`); method changes
JODI->CROSSING (`428` -> exact 9-selection engine order) and JODI->COPY_PASTE; Palti toggle
5->9 selections; leading zeros persisted as strings; `v1->v2->v3` chain with a revision per step
and a stable `publicRef`; **payout multiplier snapshot unchanged** after the platform rate is
set to 95. **wallet delta** - larger wager debits exactly the difference via one
`BET_EDIT_DEBIT` row (key `BET_EDIT_DEBIT:<betId>:v2`, `referenceType`/`referenceId`), smaller
wager refunds exactly the difference via one `BET_EDIT_REFUND`, same-total edit writes a
revision but **no** wallet row (`walletDeltaPaise 0`), an over-budget edit -> `INSUFFICIENT_BALANCE`
with the bet / version / wallet unchanged and no revision. **cutoff boundaries** - exactly at
`editCutoffAt` -> `EDIT_WINDOW_CLOSED` (nothing changed), one second before -> success, during
`CLOSING_SOON` -> `EDIT_WINDOW_CLOSED`, after close -> `MARKET_CLOSED`, disabled market ->
`MARKET_DISABLED`, and a cutoff crossed between the pre-check and the transaction -> caught at
the transactional boundary with a full rollback. **concurrency** - two edits racing from
`version 1` -> exactly one transitions to v2, the other `STALE_VERSION`, one revision, wallet
moved at most once; a stale `expectedVersion` after a prior edit -> `STALE_VERSION`, no change.
**idempotency** - replaying the same successful edit returns the same result with no second
wallet movement or version bump; reusing an `editRequestId` for a different target wager ->
`DUPLICATE_REQUEST`; replaying a successful edit **after the cutoff** still returns the previous
result (not `EDIT_WINDOW_CLOSED`), while a fresh `editRequestId` after the cutoff still fails
normally. **atomicity / scope** - a forced failure right after the wallet movement rolls the
whole transaction back (balance restored, version 1, no revision, no ledger row); after several
edits `withdrawals` / `WIN_CREDIT` / `WITHDRAWAL_*` counts are `0`, every round stays
`settlementStatus: PENDING`, and the bet stays `ACTIVE` with `winningNumber` / `payoutPaise` /
`settledAt` `null`.

Manual HTTP verification used a **disposable** `mongodb-memory-server-core` replica set (seeded
via `seedFoundation()` with the six markets + platform settings, then two ACTIVE players and one
ACTIVE admin; every market's schedule widened to open-all-day / no edit lock in the throwaway DB
so the wall clock never mattered) plus a real `next dev` on port 3838 - the user's configured
`.env` / database was never touched; the temporary driver (`scratchpad/verify-4a4.ts`) was
deleted before commit. 18 automated assertions, all PASS: unauthenticated `GET /api/bets` ->
`401`; player + admin password logins issuing `diamond_session` cookies; `POST
/api/wallet/mock-deposit` funding player 1; `POST /api/bets` JODI -> `200` with a `<CODE>-MMDD-`
`publicRef`; `GET /api/bets` -> exactly the one bet, `canEditNow: true`, no `userId` /
`marketId`; `GET /api/bets/<id>` and `GET /api/bets/<publicRef>` (lower-cased) -> `200`,
`revisions: []`; `PATCH /api/bets/<id>` adding a selection with `expectedVersion: 1` -> `200`,
`version: 2`, one `revisions[]` entry, `totalStakePaise` 4000; `GET /api/wallet/transactions`
carrying one `BET_EDIT_DEBIT` row of exactly ₹10 (the stake difference) with no
`idempotencyKey`; the same `editRequestId` replayed -> `200`, `version` still `2`; the same
`editRequestId` with different numbers -> `409 DUPLICATE_REQUEST`; a stale `expectedVersion` ->
`409 STALE_VERSION`; a smaller-wager `PATCH` -> `200`, `version: 3`, a `BET_EDIT_REFUND` row
appears; `PATCH` with a mismatched `Origin` -> `403`; the second player reading or editing the
first player's bet by id and by `publicRef` -> `404 BET_NOT_FOUND`; an ADMIN session on
`GET /api/bets` and `PATCH /api/bets/[id]` -> `403`; and a final reconnect confirming exactly
two `betRevisions`, zero `withdrawals`, zero `WIN_CREDIT`. The dev server, the disposable
database and the temporary script were stopped and removed afterward.

No live `npm run db:check` / `npm run db:seed` against the user's configured database was run in
this window; all database verification used disposable replica sets. Window 2A visual quality
remains pending Codex visual-browser refinement.

## Window 5A handoff status

Window 5A (player withdrawal lifecycle backend) is complete. **Backend / financial domain
only.** See ARCHITECTURE.md's "Window 5A" section for the design, DOMAIN_RULES.md's "Window 5A
implementation clarification" for the frozen-rule mapping, API_CONTRACTS.md's "Window 5A -
implemented player withdrawal contract" for exact shapes, and DATABASE.md's `withdrawals`
changelog row for the schema delta.

Implemented:

- `modules/withdrawals/services/withdrawal.service.ts` -
  - `requestWithdrawal(input, options?)` -> `{ withdrawal, wallet, serverNow }`. Amount guard
    (`INVALID_AMOUNT` below Rs 1 / `MONEY_OUT_OF_RANGE`), existing-success `clientRequestId`
    idempotency recovery **first** (logical request = method + amount + destination; conflict ->
    `DUPLICATE_REQUEST`), `createPlayerWallet` (Rs 0, never grants funds), one `withTransaction`
    doing `reserveInSession` (`WITHDRAWAL_RESERVED:<id>`, `available -= X` / `reserved += X`,
    `INSUFFICIENT_BALANCE` when `available < X` = the "maximum = available" rule) -> native
    `Withdrawal.collection.insertOne` of the PENDING doc; lost `(userId, clientRequestId)` race
    recovered outside the aborted transaction.
  - `cancelWithdrawal(input, options?)` -> `{ withdrawal, wallet, serverNow }`. Player-owned,
    `PENDING -> CANCELLED`, `releaseReservedInSession` (`WITHDRAWAL_RELEASED:<id>`,
    `available += X` / `reserved -= X`); already-CANCELLED -> DTO with **no** second release;
    APPROVED/REJECTED -> `WITHDRAWAL_NOT_PENDING`; retried / concurrent cancel releases exactly
    once (deterministic on state + the fixed ledger key), reserved never negative; the
    withdrawal is **not** deleted.
  - `listPlayerWithdrawals` (own only, newest first, bounded `limit` 1-50 default 20, opaque
    `(createdAt, _id)` cursor, optional `status` filter), `getPlayerWithdrawalDetail` (own,
    24-hex id, `WITHDRAWAL_NOT_FOUND` for missing/non-owned/malformed - indistinguishable),
    `resolveOwnedWithdrawal`, `toWithdrawalDTO` (masked `destination.summary`; generic
    `decidedAt` mapped onto `cancelledAt` / `approvedAt` / `rejectedAt`; no `userId` /
    `paymentDetails` / `clientRequestId` / `decidedByAdminId` / ledger key), `assertWithdrawalAmount`,
    `encode/decodeWithdrawalCursor` / `clampWithdrawalListLimit`, `withdrawalReserveKey` /
    `withdrawalReleaseKey` / `withdrawalApproveKey`.
  - **FUTURE ADMIN (not routed in 5A):** `approveWithdrawalByAdmin` (`PENDING -> APPROVED`,
    `finalizeReservedInSession` - `reserved -= X` only, `WITHDRAWAL_APPROVED:<id>`, available
    unchanged, no real payout) and `rejectWithdrawalByAdmin` (`PENDING -> REJECTED` + reason,
    `releaseReservedInSession`, `WITHDRAWAL_RELEASED:<id>`). Both share `applyTerminalTransition`
    (in-session re-read -> wallet primitive -> CAS `updateOne({ status: "PENDING" })`;
    `matchedCount 0` aborts the whole transaction). Window 6A routes these.
- `modules/withdrawals/validators/withdrawal-input.ts` - `createWithdrawalSchema` (Zod
  discriminated union on `method`, each branch `.strict()`; `amountPaise: int>0`,
  `clientRequestId: z.uuid()`; BANK `bank:{ accountHolderName, accountNumber /^\d{6,20}$/,
  confirmAccountNumber, ifsc /^[A-Z]{4}0[A-Z0-9]{6}$/, bankName? }` with a `.refine` equality
  check on the confirmation; UPI `upi:{ upiId }` syntactic check, no external call),
  `toPaymentDetails` (drops the confirmation), `buildDestinationSummary` (mask),
  `withdrawalsListQuerySchema`, `cancelWithdrawalSchema`.
- `src/app/api/withdrawals/route.ts` - `GET` (own list) + `POST` (create).
  `src/app/api/withdrawals/[id]/route.ts` - `GET` (own detail).
  `src/app/api/withdrawals/[id]/cancel/route.ts` - `POST` (cancel own PENDING). All ACTIVE
  PLAYER, `force-dynamic`; both `POST`s same-origin; no `userId` from the client.
- `lib/errors/domain-error.ts` - added `WITHDRAWAL_NOT_FOUND` (404). `WITHDRAWAL_NOT_PENDING`
  (409) already existed and is now used.
- `withdrawal.model.ts` - added `destinationSummary` (safe, required, immutable), bounded
  `paymentDetails` string lengths, `immutable` on the request-time fields, and
  `WithdrawalRecord` / `WithdrawalDoc` / `WithdrawalRow` type-only exports. **No index change**
  (the three existing indexes, including UNIQUE `(userId, clientRequestId)`, are unchanged).

Deliberately **not** done (out of window): any withdrawal / wallet UI, `/api/admin/withdrawals`
approve/reject routes, admin dashboard, real payout / Razorpay / UPI payout / bank API,
settlement, result declaration, betting UI, any Window 2A visual redesign. `bets`,
`betRevisions`, settlement collections and `WIN_CREDIT` are untouched. No at-rest encryption of
`paymentDetails` was added - it is documented as future production hardening.

**Window 2A's visual design remains pending a dedicated Codex visual-browser refinement pass.
This window built no UI and attempted no visual redesign.**

## Verification record - 2026-09-07 (Window 5A)

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS; strict TypeScript incl. new service / validator / routes / tests |
| `npm.cmd run lint` | PASS; no warnings |
| `npm.cmd test` | PASS; 210 tests across 16 files (190 prior + 20 new in `withdrawal.test.ts`; `schemas.test.ts` withdrawal fixture updated for the new required `destinationSummary`) |
| `npm.cmd run test:integration` | PASS; 175 tests across 8 files (145 prior + 30 new in `withdrawal.integration.ts`) against a disposable MongoDB 8.2.6 replica set |
| `npm.cmd run build` | PASS; `/api/withdrawals`, `/api/withdrawals/[id]`, `/api/withdrawals/[id]/cancel` registered as dynamic route handlers |
| `git diff --check` | PASS; no whitespace errors (LF->CRLF advisories only, matching repo convention) |
| Manual HTTP/E2E verification | PASS - see below |

New unit coverage (`withdrawal.test.ts`): `createWithdrawalSchema` accepts BANK (with/without
bankName) and UPI, upper-cases IFSC, lower-cases UPI id, rejects a confirmation mismatch, a
malformed IFSC / account number / UPI id, a missing / non-UUID `clientRequestId`, a
non-positive / fractional amount, and every `.strict()` violation (`userId`, `status`,
`destinationSummary`, cross-method payload, stray sub-key); `toPaymentDetails` drops the
confirmation and omits an absent `bankName`; `buildDestinationSummary` masks BANK to the last
four digits (default "Bank" prefix) and UPI to two handle chars + PSP; `withdrawalsListQuerySchema`
default 20 / range `[1,50]` / rejected stray param / each status accepted; `cancelWithdrawalSchema`
empty-body only; `assertWithdrawalAmount` (100 ok, 99 -> `INVALID_AMOUNT`, fractional / unsafe ->
`MONEY_OUT_OF_RANGE`); ledger-key determinism + shape; withdrawal cursor `(createdAt, _id)`
round-trip + malformed -> `INVALID_INPUT`; `clampWithdrawalListLimit`; `toWithdrawalDTO` maps
`decidedAt` onto the status-specific field, sets `rejectionReason` only when REJECTED, and its
key allow-list excludes `userId` / `paymentDetails` / `clientRequestId` / `decidedByAdminId` /
`destinationSummary` / `__v`.

New integration coverage (`withdrawal.integration.ts`, disposable replica set): **request
success** - UPI and BANK create a PENDING withdrawal, move `available -> reserved` exactly, and
write one `WITHDRAWAL_RESERVED` row with exact before/delta/after values, `referenceType:
"WITHDRAWAL"`, `referenceId` and key `WITHDRAWAL_RESERVED:<id>`; `paymentDetails` stored once
(never the `confirmAccountNumber`), response carries only a masked `destination.summary`; Rs 1
(100 paise) accepted; the frozen Rs 1000 -> withdraw Rs 300 -> Rs 700 / Rs 300 example.
**validation / guards** - confirmation mismatch rejected before any write; below Rs 1 ->
`INVALID_AMOUNT` no writes; amount above available -> `INSUFFICIENT_BALANCE` no writes; reserved
funds cannot be withdrawn again; a forced failure right after the reserve rolls the whole
transaction back (no withdrawal, wallet and ledger unchanged). **idempotency** - a same-payload
retry returns the original withdrawal with no second reserve; the same id + a different amount
or a different method -> `DUPLICATE_REQUEST` with no second withdrawal/reserve; two concurrent
identical requests -> one withdrawal / one reserve / one ledger row, both callers the same id.
**concurrency** - Rs 100 available, two concurrent Rs 80 withdrawals -> one PENDING, one
`INSUFFICIENT_BALANCE`, final `available 2000 / reserved 8000`, one withdrawal. **reads** - a
player lists only their own; bounded newest-first `(createdAt, _id)` cursor pagination walks the
whole history with no gaps or repeats; `status` filter narrows to PENDING / CANCELLED; max
limit respected; malformed cursor -> `INVALID_INPUT`; detail is owner-only and a foreign /
malformed / unknown id is an indistinguishable `WITHDRAWAL_NOT_FOUND`. **cancellation** -
`PENDING -> CANCELLED` restores available and writes one `WITHDRAWAL_RELEASED` row with exact
deltas and key; a second cancel is a no-op returning the CANCELLED withdrawal (one release
total); two concurrent cancels release the reserved funds **exactly once**, reserved never
negative, exactly one `WITHDRAWAL_RELEASED` row; an APPROVED / REJECTED withdrawal cannot be
cancelled (`WITHDRAWAL_NOT_PENDING`); a forced failure right after the release rolls back
(stays PENDING, still reserved, no release row); a foreign player cannot cancel it
(`WITHDRAWAL_NOT_FOUND`). **future admin primitives** - approve -> APPROVED, reserved cleared,
available UNCHANGED, one `WITHDRAWAL_APPROVED` row (deltas `available 0 / reserved -X`),
`decidedByAdminId` stored; approve is idempotent (repeat returns APPROVED, one approved row);
reject -> REJECTED with stored reason, funds released, one `WITHDRAWAL_RELEASED` row; reject
requires a non-empty reason (`INVALID_INPUT`); a cancelled withdrawal can no longer be approved
or rejected (mutually exclusive terminal transition); a forced failure right after the approve
movement rolls back (stays PENDING). **scope guard** - a full withdrawal exercise writes no
`bets` / `betRevisions`, no `WIN_CREDIT` / `BET_*` ledger rows, and no `marketRounds`.

Manual HTTP verification used a **disposable** `mongodb-memory-server-core` replica set (seeded
via `seedFoundation()`, then two ACTIVE players and one ACTIVE admin) plus a real `next dev` on
port 3939 - the user's configured `.env` / database was never touched; the temporary driver
(`scratchpad/verify-5a.ts`) was deleted before commit; account numbers, UPI ids, cookies and
secrets were never printed. 31 automated assertions, all PASS: unauthenticated `GET` / `POST
/api/withdrawals` -> `401`; player + admin password logins issuing `diamond_session` cookies; an
ADMIN session on `GET` and `POST /api/withdrawals` -> `403`; `GET /api/admin/withdrawals` ->
`404` (no admin route exists yet); `POST /api/wallet/mock-deposit` funding player 1; `POST
/api/withdrawals` UPI Rs 300 -> `200` PENDING with a masked `destination.summary` and no
`paymentDetails` / `userId`; `GET /api/wallet` -> `available 70000 / reserved 30000`; `GET
/api/withdrawals` -> exactly the one row, no sensitive fields; `GET /api/withdrawals/<id>` ->
`200`; a retry with the same `clientRequestId` + payload -> `200` same id and no second reserve;
the same id with a different amount -> `409 DUPLICATE_REQUEST`; `POST
/api/withdrawals/<id>/cancel` -> `200 CANCELLED` and wallet restored to `100000 / 0`; the retry
cancel -> `200 CANCELLED` with the wallet unchanged; `GET /api/wallet/transactions` carrying
exactly one `WITHDRAWAL_RESERVED` and one `WITHDRAWAL_RELEASED` row with no `idempotencyKey`;
`POST /api/withdrawals` BANK valid -> `200` with a `•••• 1234` summary; an account-number
confirmation mismatch -> `400 INVALID_INPUT`; a below-Rs 1 amount -> `422 INVALID_AMOUNT`; an
amount over the balance -> `422 INSUFFICIENT_BALANCE`; a mismatched `Origin` on `POST
/api/withdrawals` and on `.../cancel` -> `403`; the second player reading or cancelling the
first player's withdrawal -> `404 WITHDRAWAL_NOT_FOUND`; a malformed `:id` -> `404`; and a final
reconnect confirming zero `bets` / `betRevisions` / `WIN_CREDIT` and exactly two `withdrawals`
rows. The dev server, the disposable database and the temporary script were stopped and removed
afterward.

No live `npm run db:check` / `npm run db:seed` against the user's configured database was run in
this window; all Window 5A database verification used disposable replica sets. Window 2A visual quality
remains pending Codex visual-browser refinement.

## Window 6A1 handoff status

Window 6A1 (admin player management, manual wallet movement, DB provisioning & demo seed) is
complete. **Backend / financial domain only - no admin UI.** See ARCHITECTURE.md's "Window 6A1"
section for the design, DOMAIN_RULES.md's "Window 6A1 implementation clarification" for the
frozen-rule mapping, API_CONTRACTS.md's "Window 6A1 - implemented admin player & wallet contract"
for exact shapes, DATABASE.md's Window 6A1 section for the one additive schema field, and
ADMIN_SPEC.md / SECURITY_AND_AUTH.md's Window 6A1 sections.

Implemented:

- `src/modules/admin/services/admin-player.service.ts` - `createPlayer` (role server-forced
  PLAYER + Rs 0 wallet + `PLAYER_CREATED`, one transaction; `LOGIN_ID_TAKEN` / `IDENTIFIER_TAKEN`),
  `listPlayers` (PLAYER only, newest-first `(createdAt, _id)` cursor, `search` on normalized
  loginId / email substring + exact phone, `status` filter, wallet balances + bet/withdrawal
  counts batch-loaded via one `$in` + two `$group` - no N+1), `getPlayerDetail`,
  `disablePlayer` / `enablePlayer` (CAS `updateOne` in a transaction; disable also
  `revokeAllUserSessions(userId, session)`; audit only on a real transition; idempotent),
  `resetPlayerPassword` (hash + `passwordChangedAt` + revoke all sessions + audit, one
  transaction; hash never returned), `getPlayerWalletView`, `listPlayerBetsForAdmin` /
  `listPlayerWithdrawalsForAdmin` (reuse the sanitized player read services), `resolvePlayer`
  (missing / malformed / ADMIN id all an indistinguishable `PLAYER_NOT_FOUND`).
- `src/modules/admin/services/admin-wallet.service.ts` - `adminCreditWallet` / `adminDebitWallet`
  sharing one `adjust(type, input, options)`: `resolvePlayer` -> `assertAdminAdjustmentAmount`
  (>= Rs 1) -> required non-empty `reason` -> `createPlayerWallet` -> key
  `ADMIN_WALLET_ADJUSTMENT:<adminId>:<clientRequestId>` (operation-agnostic) -> existing-success
  recovery first (mismatch on type / amount / player / reason / reference -> `DUPLICATE_REQUEST`)
  -> one `withTransaction` doing `applyWalletMovement` (immutable `ADMIN_CREDIT` / `ADMIN_DEBIT`
  ledger row carrying `adminReason` + `adminPaymentReference` + `createdByAdminId`) +
  `writeAuditLog` (skipped on the in-transaction idempotent-replay path so a write-conflict
  retry never double-audits) -> E11000 recovery outside the aborted transaction.
  `afterWalletMovement` test seam. `listPlayerWalletTransactionsForAdmin` ->
  `AdminWalletTransactionDTO` (adds `reason` / `paymentReference` / `actorAdminId`, never
  `idempotencyKey`).
- `src/modules/admin/services/player-deletion.service.ts` - `playerDeletionService.purgePlayer()`
  implementing the Window 6 `PlayerDeletionService` contract + `purgePlayerById`. One
  `withTransaction`: delete `betRevisions` (by userId or betId), `bets`, `withdrawals`,
  `walletTransactions`, `wallets`, `sessions`, `otpRequests`, every `auditLogs` row with
  `subjectUserId` OR `entityId` = the player, then CAS-delete the `user` on `{role:"PLAYER"}`;
  finally `writeAuditLog(PLAYER_DELETION_COMPLETED)` with `entityType:"Player"` and NO entityId /
  subjectUserId / snapshot. ADMIN targets refused. No tombstone, no deny-list.
- `src/modules/audit/services/audit-log.service.ts` - `writeAuditLog(input, session?)`, the single
  `auditLogs` writer. `redactAuditSnapshot` deep-replaces any `password` / `passwordHash` /
  `newPassword` / `token` / `codeHash` / `secret`-style key (case-insensitive, any depth). Seven
  actions: `PLAYER_CREATED`, `PLAYER_DISABLED`, `PLAYER_ENABLED`, `PLAYER_PASSWORD_RESET`,
  `PLAYER_DELETION_COMPLETED`, `ADMIN_WALLET_CREDIT`, `ADMIN_WALLET_DEBIT`.
- `src/modules/admin/validators/admin-player-input.ts` - strict Zod for every route
  (`createPlayerSchema` has NO `role` field).
- `src/app/api/admin/players/` - 10 route files: `GET|POST /players`, `GET|DELETE /players/[id]`,
  `POST /players/[id]/status`, `POST /players/[id]/reset-password`, `GET /players/[id]/wallet`,
  `GET /players/[id]/wallet/transactions`, `POST /players/[id]/wallet/credit`,
  `POST /players/[id]/wallet/debit`, `GET /players/[id]/bets`, `GET /players/[id]/withdrawals`.
  All `apiRoute` + `force-dynamic` + `requireAdmin()`; every mutation also `isTrustedOrigin`.
  Anonymous -> `401`, PLAYER -> `403`. `201` on create, `200` elsewhere.
- `src/modules/wallet/models/wallet-transaction.model.ts` - **+ `adminReason` (<= 500),
  + `adminPaymentReference` (<= 200)**, both optional, additive. No index change.
- `src/modules/wallet/services/wallet.service.ts` - `WalletMovementInput` / `NamedMovementInput`
  gained optional `adminReason` / `adminPaymentReference`; `applyWalletMovement` persists them;
  `assertSameOperation` compares them (replayed key + materially different reason/reference ->
  `DUPLICATE_REQUEST`). No other change.
- `src/modules/auth/services/session.service.ts` - `revokeAllUserSessions(userId, session?)`
  gained the optional transaction session param.
- `src/lib/errors/domain-error.ts` - added `PLAYER_NOT_FOUND` (404), `LOGIN_ID_TAKEN` (409),
  `IDENTIFIER_TAKEN` (409). `INVALID_AMOUNT` / `INSUFFICIENT_BALANCE` / `MONEY_OUT_OF_RANGE`
  (422), `DUPLICATE_REQUEST` (409), `INVALID_INPUT` (400), `FORBIDDEN` / `UNAUTHENTICATED`
  reused verbatim.
- `scripts/provision-db.ts` (`npm run db:provision`) + `scripts/seed-demo.ts`
  (`npm run db:seed-demo`) + `getDemoSeedEnv()` in `src/lib/config/env.ts` +
  `.env.example` placeholders (`DEMO_SEED_ENABLED`, `DEMO_PLAYER_PHONE`, four demo password
  vars - all blank).

Deliberately **not** done (out of window): any admin UI (Codex owns the frontend);
`/api/admin/withdrawals` approve/reject; admin market config, result declaration, game-rate API;
a full admin audit-browser API; settlement / `WIN_CREDIT`. The Window 5A internal
`approveWithdrawalByAdmin` / `rejectWithdrawalByAdmin` primitives are unchanged and still
unrouted - Window 6A2 routes them under "Mark Paid & Approve" (finalizes RESERVED only). No
`admins` / `deposits` / `wins` / `transactionHistory` / `resultHistory` collection. No OTP
architecture change. No frontend file touched.

## Verification record - 2026-09-07 (Window 6A1)

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS; strict TypeScript incl. the new admin module, audit service, two scripts, routes and tests |
| `npm.cmd run lint` | PASS; no warnings |
| `npm.cmd test` | PASS; 227 tests across 17 files (210 prior + 17 new in `admin-validators.test.ts`) |
| `npm.cmd run test:integration` | PASS; 202 tests across 10 files (175 prior + 22 new in `admin.integration.ts` + 5 new in `admin-provisioning.integration.ts`) against a disposable MongoDB 8.2.6 replica set |
| `npm.cmd run build` | PASS; all 10 `/api/admin/players/...` routes registered as dynamic route handlers |
| `git diff --check` | PASS; no whitespace errors (LF->CRLF advisories only, matching repo convention) |
| Real HTTP verification | PASS - 32/32 assertions (disposable replica set + real `next dev`) |
| Configured-DB provisioning | PASS (non-destructive) |
| Configured-DB demo seed + rerun | PASS (idempotent) |
| Configured-DB demo login verification | PASS |

New unit coverage (`admin-validators.test.ts`, 17 tests): `createPlayerSchema` normalizes
loginId, lower-cases email, and rejects a client `role` / `status` / `passwordHash` / empty name
/ missing password (strict); `listPlayersQuerySchema` default limit 25 / range `[1,100]` /
status enum / stray-param rejection; `setPlayerStatusSchema` and `resetPlayerPasswordSchema`
value + stray-field checks; `adminWalletAdjustmentSchema` trims + requires `reason`, rejects a
non-positive / fractional amount, a non-UUID `clientRequestId`, a client-supplied resulting
balance and every stray field; query-schema bounds; `buildAdminAdjustmentKey` determinism +
admin/request scoping + operation-agnosticism; `assertAdminAdjustmentAmount` (100 ok, 99 ->
`INVALID_AMOUNT`, fractional / unsafe -> `MONEY_OUT_OF_RANGE`); `toAdminWalletTransactionDTO`
exposes `reason` / `paymentReference` / `actorAdminId` and never `idempotencyKey` / `adminReason`
/ `userId`; `auditActions` is exactly the seven; `redactAuditSnapshot` redacts secret-bearing
keys at any depth (incl. inside arrays) and leaves the rest intact.

New integration coverage (`admin.integration.ts` 22 tests + `admin-provisioning.integration.ts`
5 tests, disposable replica set):

- **create** - user + Rs 0 wallet + `PLAYER_CREATED` atomic; loginId normalized; `createdBy` set;
  `passwordHash` verifies; audit carries no hash / password; duplicate loginId -> `LOGIN_ID_TAKEN`
  with no second user / wallet / audit; duplicate phone -> `IDENTIFIER_TAKEN`.
- **list** - PLAYERs only (fixture admins never listed), newest-first; `(createdAt, _id)` cursor
  walks 5 rows across 3 pages with no gaps / repeats; `status` + `search` filters; wallet
  balances + counts joined.
- **detail** - sanitized, `total = available + reserved`, no `passwordHash`; ADMIN id / bad hex
  -> `PLAYER_NOT_FOUND`.
- **disable / enable** - status flip; disable deletes every session (and `findActiveSessionUser`
  then returns null for the old token) + one `PLAYER_DISABLED`; repeat disable writes no second
  audit; enable creates no session + one `PLAYER_ENABLED`; repeat writes no second audit;
  disabling an ADMIN target -> `PLAYER_NOT_FOUND`, admin stays ACTIVE.
- **reset password** - hash changes, `verifyPassword(new)` true / `verifyPassword(old)` false,
  every session revoked, `PLAYER_PASSWORD_RESET` audit with no password material; ADMIN target
  -> `PLAYER_NOT_FOUND`.
- **ADMIN_CREDIT** - wallet + immutable ledger row (`adminReason` / `adminPaymentReference` /
  `createdByAdminId` present, exact before/delta/after, `referenceType:"ADMIN_ADJUSTMENT"`) +
  `ADMIN_WALLET_CREDIT` audit, all one transaction; server computes the balance; below Rs 1 ->
  `INVALID_AMOUNT` and an ADMIN target -> `PLAYER_NOT_FOUND`, both with no writes.
- **ADMIN_DEBIT** - debits available, `reserved` untouched, can't go negative
  (`INSUFFICIENT_BALANCE`), and the earlier `ADMIN_CREDIT` row is byte-identical before and after.
- **idempotency** - exact replay -> `idempotentReplay`, one movement / ledger / audit, same
  txId; same `clientRequestId` with a different amount / player / operation (credit<->debit) /
  reason -> `DUPLICATE_REQUEST` with no second movement.
- **concurrency** - two concurrent identical credits (same `clientRequestId`) -> one movement,
  one ledger row, **one** audit row, both callers the same txId, credited once; Rs 100 with two
  concurrent distinct Rs 80 debits -> one success, one `INSUFFICIENT_BALANCE`, final Rs 20,
  never negative, one `ADMIN_WALLET_DEBIT` audit; a forced failure right after the wallet
  movement rolls back everything (no money, no ledger, no audit); a combined `ADMIN_CREDIT` +
  reserve in one caller-owned transaction leaves consistent balances.
- **hard delete** - with sessions + OTP + wallet + ledger + bet + revision + withdrawal +
  identifying audits present, `purgePlayer` leaves **zero** rows for the player in every
  collection (incl. audits by `subjectUserId` and `entityId`); the old session token no longer
  resolves; the only surviving audit is `PLAYER_DELETION_COMPLETED` with no `subjectUserId` /
  `entityId` / snapshot and no loginId / id / phone anywhere in it; the freed loginId is
  immediately recreatable as a new, differently-`_id`'d player; purging an ADMIN target ->
  `PLAYER_NOT_FOUND`, admin intact.
- **provisioning** - `db:provision` first run: all 12 canonical collections present (`stdout`
  lists each) and `listCollections` returns exactly the 12; second run: `created this run: 0`,
  still 12, and an operator's customized `markets.enabled` / `platformSettings.payoutMultiplier`
  survive; markets = 6.
- **demo seed** - without `DEMO_SEED_ENABLED` the CLI exits non-zero and writes no users; with
  the flag + passwords: 4 accounts (`test1` PLAYER + `doni` / `pankaj` / `gopal` ADMIN, all
  `scrypt-v1$` hashes, admins with no wallet), `test1` wallet `available 1_000_000 / reserved 0
  / INR`, exactly one `ADMIN_CREDIT` with key `ADMIN_CREDIT:DEMO_OPENING_BALANCE:test1:v1`, and
  stdout never contains a password; rerun: `preserved 4` / `opening credit: already-present`,
  still 4 users, still one opening credit, balance still `1_000_000`; a pre-existing `doni` as
  PLAYER makes the CLI exit non-zero with `doni` untouched and no other demo user written.
- **login verification** - `loginWithPassword` for `test1` (PLAYER portal) and `doni` / `pankaj`
  / `gopal` (ADMIN portal) all succeed; `test1` via ADMIN portal and `doni` via PLAYER portal
  both `INVALID_CREDENTIALS`.

Real HTTP verification used a **disposable** `mongodb-memory-server-core` replica set (seeded
via `seedFoundation()` + one ACTIVE admin + one ACTIVE player) and a real `next dev` on port
3945 - the user's configured `.env` / database was never used for data; the temporary driver
lived at the worktree root and was deleted before commit; no cookie / password / hash / secret
was printed. 32 assertions, all PASS: anonymous `GET` / `POST /api/admin/players` -> `401`;
player + admin logins issuing `diamond_session` cookies; a PLAYER session -> `403` on every
admin route; an ADMIN session -> `200`; `POST /api/admin/players` -> `201` with a Rs 0 wallet; a
mismatched `Origin` on `POST /api/admin/players` -> `403`; `ADMIN_CREDIT` -> `200` with a
server-computed `available 500000`; an exact `clientRequestId` replay -> `200` `idempotentReplay`;
a conflicting reuse -> `409 DUPLICATE_REQUEST`; `ADMIN_DEBIT` -> `200`; a debit beyond balance
-> `422 INSUFFICIENT_BALANCE`; a sub-Rs 1 credit -> `422 INVALID_AMOUNT`;
`GET .../wallet/transactions` carrying `reason` / `paymentReference` / `actorAdminId` and **no**
`idempotencyKey`; `GET .../wallet`, `.../bets`, `.../withdrawals`, `.../[id]` -> `200`;
`status -> DISABLED` -> the player's live session `401`s on `/api/auth/me` and a fresh login ->
`403`; `status -> ACTIVE`; `reset-password` -> `200` with no hash in the body and login with the
new password -> `200`; `GET /api/admin/players/<adminId>` -> `404 PLAYER_NOT_FOUND`; `DELETE` ->
`200`, then detail -> `404`, then the deleted credential -> `401`, then the freed loginId
recreatable as a new player. The dev server, the disposable database and the temporary driver
were stopped and removed afterward.

Configured deployment database (authorized by the brief; NON-DESTRUCTIVE scripts only; the
`.env` was copied byte-for-byte from the frontend worktree for this run and then restored, is
gitignored and was never staged; no URI, credential or hash was printed):

- `npm run db:provision` -> PASS. Database name `test` (the configured SRV URI carries no
  explicit database path, so Mongoose uses the default `test`). All 12 canonical collections
  present afterward (2 created this run, the other 10 pre-existing); zero non-canonical
  collections. Index counts: users 4, sessions 4, otpRequests 3, wallets 2, walletTransactions
  4, markets 3, marketRounds 4, bets 6, betRevisions 4, withdrawals 4, auditLogs 4,
  platformSettings 2. `platformSettings` singleton present; markets = 6.
- `npm run db:seed-demo` -> PASS (`created 4`, `opening credit: applied`), rerun -> PASS
  (`preserved 4`, `opening credit: already-present`).
- Post-seed read-only inspection: `test1` PLAYER / ACTIVE / hashed; `doni` / `pankaj` / `gopal`
  ADMIN / ACTIVE / hashed; admins have no wallet; `test1` wallet `available 1_000_000 /
  reserved 0 / INR`; exactly one `ADMIN_CREDIT` for `test1` with key
  `ADMIN_CREDIT:DEMO_OPENING_BALANCE:test1:v1` (one `ADMIN_CREDIT` total - the rerun added none).
- Login verification against the configured database (auth-service check): `test1` authenticates
  on the PLAYER portal; `doni` / `pankaj` / `gopal` authenticate on the ADMIN portal; `test1`
  via the ADMIN portal and `doni` via the PLAYER portal are both rejected `INVALID_CREDENTIALS`;
  a wrong password is rejected.

No secret value (URI, `SESSION_SECRET`, DB credential, password, password hash, raw session
cookie, raw OTP) was printed or committed at any point. All scratch drivers / inspection
scripts were deleted before commit.
