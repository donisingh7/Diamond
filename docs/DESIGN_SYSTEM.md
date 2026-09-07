# Design direction

Read [CODEX_RULES.md](CODEX_RULES.md) first. These requirements are authoritative and originate from the approved Window 1 brief. DOMAIN_RULES.md owns business rules; the roadmap limits implementation scope. Future-facing descriptions do not imply implemented features.

## TICKET UX — DOCUMENT NOW, BUILD LATER

The project's signature betting interaction is a **premium bet ticket**.

Document it in:

```text
DESIGN_SYSTEM.md
PLAYER_UX.md
```

Before placing bet:

```text
User builds bet
→ Review Bet
→ Background softly blurs/scales back
→ Premium ticket rises into view
→ User reviews
→ Confirm
```

Ticket contains:

* market
* entry method
* selected numbers
* stake per selection
* selection count
* total amount
* payout rate
* market timing/edit cutoff information

Do not show a final bet number until successful server-side bet creation.

After confirmation the same ticket should transform into a success ticket containing:

* success state
* public bet reference
* selections
* amount
* total
* rate
* placed timestamp
* edit-until timestamp
* download/save action
* view my bets action

Visual concept:

**Apple-inspired premium glass + elegant receipt/ticket geometry.**

The ticket bottom edge must have:

**very subtle receipt-like perforation/notch geometry.**

Not cartoonish zig-zags.

This should become one of the product's visual signatures.

Ticket PDF/image is a rendering of database bet data.

Do NOT permanently store generated ticket files in MongoDB/server storage for prototype.

## DESIGN SYSTEM — DOCUMENT DIRECTION

The player website AND admin interface must eventually feel premium.

Visual direction:

```text
Apple-inspired product polish
+
premium dark glass surfaces
+
gaming energy used carefully
+
fintech-level clarity
```

Avoid:

* cheap casino visuals
* rainbow gradients everywhere
* flashing UI
* excessive glow
* overcrowding
* generic Bootstrap admin styling
* excessive glass that destroys readability

Use:

* near-black/deep charcoal base
* controlled accent colors
* translucent glass hierarchy
* tasteful backdrop blur
* subtle borders
* large rounded corners where appropriate
* excellent typography
* clean numeric hierarchy
* gentle depth
* premium spacing
* responsive layouts
* meaningful motion

Glass is visual flavor, NOT a requirement that every surface be transparent.

Dense tables/admin content may use more opaque surfaces for readability.

## MOTION DIRECTION

Document standardized motion principles now.

Future interactions include:

* subtle hover lift
* slight press scale
* spring return
* tabs with animated indicator
* smooth sidebar collapse
* bottom sheet transitions
* modal scale/fade
* page fade/small translation
* market card hover reflection
* number selection feedback
* ticket entrance
* ticket success transformation
* skeleton loading states
* button-local loading states
* subtle success animations

Avoid long cinematic transitions.

Interactive responses should feel immediate.

Support `prefers-reduced-motion`.

## INITIAL UI FOUNDATION

Do NOT build the entire design system in this window.

That is Window 2.

However establish:

* global CSS/token organization
* dark-theme foundation
* typography strategy
* base page background
* root providers
* motion provider/setup if needed
* responsive container conventions
* clean app structure

If choosing fonts, use high-quality modern web fonts available through normal Next.js mechanisms.

Do not attempt to copy proprietary Apple fonts.

The visual direction should be inspired by premium Apple-like product polish, not copied assets.

## Window 1 token implementation

`src/app/globals.css` owns background #090b10, foreground #f3f4f7, opaque surface #141821, raised surface #1d2330, muted #9ca5b8, restrained accent #adc6ff and translucent border #ffffff18. Tailwind semantic aliases reference these CSS variables. Geist Sans/Mono remain on next/font/google; builds need access to Google Fonts. Numeric content uses tabular figures. No proprietary fonts/assets were copied.

The shared `.app-container` caps content at 80rem, with 1rem side gutters on small screens and 2rem from 768px. These are foundation conventions, not finished layouts. Root MotionConfig respects the user's reduced-motion setting with a short 180ms default; specific springs and ticket transitions belong to Window 2/4. Keep focus rings visible, keyboard dismissal/focus return in overlays, clear loading/error/empty states, and readable contrast. No full component kit or dashboard exists yet.

The signature ticket remains a future review/success interaction: restrained glass, elegant receipt geometry and barely perceptible bottom perforation. Desktop dialog and mobile sheet must preserve focus, fit long selections and respect safe areas. Success must use persisted server data and only then reveal publicRef. Export is generated on demand, with no permanent stored ticket file.

## Window 2A implementation

Window 2A delivered the presentation-only design system plus player/admin shells; no authentication executes yet (Window 2B). `src/app/globals.css` layers three token tiers over the Window 1 palette: `--background`/`--background-elevated` (page), opaque `--surface`/`--surface-elevated`/`--surface-interactive` (dense/admin content, always readable), and translucent `--glass`/`--glass-strong`/`--glass-subtle` (large navigation and overlay surfaces only, per the "glass is flavor, not a universal rule" direction). One accent (`--accent`) plus four semantic tones (`success`/`warning`/`danger`/`info`), each paired with a low-alpha `-subtle` background, drive badges/alerts/toasts. Radius (`--radius-sm` 8px through `--radius-xl` 28px, plus `--radius-pill`), an 4px-based spacing scale, and three shadow tiers (`surface`/`elevated`/`modal`) are shared tokens, not per-component values. Numeric content (money, countdowns, tiles) uses `font-variant-numeric: tabular-nums` via `.numeric`/`.money`/`.countdown`.

Motion lives entirely in `src/lib/ui/motion.ts`: one interactive spring for press feedback, one softer spring for sheets, a standard/emphasized easing pair, and named variants (`fadeIn`, `fadeUp`, `scaleIn`, `sheetEnter`, `drawerEnter`). `calmVariants()` collapses any variant to a plain fade when `prefers-reduced-motion` is set; the root `MotionConfig` (`src/app/providers.tsx`) sets `reducedMotion="user"` globally, and `globals.css` also hard-disables animation/transition duration under `@media (prefers-reduced-motion: reduce)` as a CSS-only backstop for non-Motion-driven transitions (skeletons, hovers). Prefer `transform`/`opacity`; nothing animates continuously.

Reusable primitives (`src/components/ui/*`): `Button`/`IconButton` (variant × size, spring press, inline loading), `Input`/`PasswordInput`/`OtpPreview` (OTP is an inert visual specimen only), `Tabs` (Radix + animated `layoutId` indicator, skipped under reduced motion), `Badge`/`Alert`/`EmptyState`/`ErrorState`/`Skeleton`/`CardSkeleton`/`PageSkeleton`, `Money` (wraps the Window 1 exact paise formatter, sign-aware), `Countdown` (presentation only — `formatCountdown` is a pure, independently tested function; a caller-supplied instant never implies eligibility), `NumberTile`, `GlassSurface`/`GlassCard`/`GlassPanel`, `TicketSurface`/`TicketSection`, `DataTable` (one semantic `<table>` plus a parallel `<dl>` card list, toggled by breakpoint, so mobile never gets a squeezed table), `Modal`/`BottomSheet`/`Drawer` (shared Radix Dialog wrapper differentiated by `kind`) and `ConfirmationDialog` (Radix AlertDialog; Escape is suppressed while an action is loading), and `ToastProvider`/`useToast` (Radix Toast, capped to 3 concurrent messages). `src/components/shared/navigation.tsx` holds `Brand`, `NavItem` (`isRouteActive` is a pure, independently tested function), and `ProfileMenu` (Radix dropdown), shared by both shells.

**TicketSurface** (`src/components/ui/surface.tsx`) is the frozen visual signature: a glass panel (`.ticket-content`) with a top diagonal highlight gradient, capped by a 9px `.ticket-edge` strip whose `mask: radial-gradient(...) repeat-x` punches a repeating row of ~3px dots — a genuinely subtle perforation, not a zig-zag. `TicketSection` children get a dashed top border once stacked, echoing receipt line items. It carries no betting logic; `/dev/design-system` renders it with clearly-labelled fake content only. `@media print` drops the drop-shadow and forces `break-inside: avoid` so a rendered ticket exports cleanly.

**Player shell** (`src/components/player/player-shell.tsx`): desktop is a sticky glass header (brand, Home/Results/My Bets/Wallet nav, balance slot, profile menu) above an `.app-container` content well. Below 1024px the header shrinks to brand + balance + profile only, and a fixed, floating, safe-area-aware bottom bar (`.player-bottom-nav`) takes over navigation across five items (Home, Results, **Play**, My Bets, Wallet) — Play is accent-colored, not resized or badged, to stay premium rather than gimmicky.

**Admin shell** (`src/components/admin/admin-shell.tsx`): a 248px sidebar (full labels) collapses to 84px (icon-only, `title` attribute as a tooltip) via a manual toggle, and auto-collapses to icon-only between 768–1199px. Below 768px the sidebar is replaced by a `Drawer`-based nav reachable from the topbar's menu button. The topbar carries title/breadcrumb, and slots for future search/notifications/profile. `DataTable`'s card fallback activates in the same sub-768px range so admin tables never overflow.

**Responsive coverage**: breakpoints sit at 374px (compact phone type-scale trims), 767/768px (admin sidebar↔drawer, data-table↔cards, login split↔stacked), 1023/1024px (player header-nav↔bottom-nav), and 1199px (admin sidebar↔compact rail); `.app-container` clamps at 80rem with 1rem gutters below 768px and 2rem above. This was verified by reading every media query against 320/375/390–430/768/1024/1280/1440+ targets and by rendering each shell/page route; no headless-browser tool was available in this environment, so pixel-level visual QA was not performed — see ROADMAP.md's verification record for what was and wasn't checked.

**Accessibility**: a skip link on each shell, 44px+ touch targets throughout (buttons, nav items, menu items), a visible 2px `:focus-visible` ring, `aria-current="page"` on the active nav item, `role="timer"`/`aria-live="off"` on `Countdown` (it never announces on every tick), and a `forced-colors` media query fallback for buttons/nav/tiles. Dialogs, the dropdown menu and tabs reuse Radix's built-in focus trap, Escape handling, focus return and ARIA roles rather than reimplementing them; `Modal`/`BottomSheet`/`Drawer` additionally move focus to the heading on open instead of the first focusable control.

**Design showcase**: `/dev/design-system` (specimens: tokens, typography, glass, buttons, inputs, tabs, badges/alerts, loading/empty/error states, overlays, number tiles, countdown, TicketSurface, DataTable, navigation) and `/dev/player/[[...section]]` / `/dev/admin/[[...section]]` (shell previews) are development-only. Both the `src/app/dev/layout.tsx` layout and each page individually call `notFound()` unless `NODE_ENV === "development"`; `tests/dev-guard.test.ts` exercises this directly (Next's `notFound()` throws a plain, context-free error, so it's testable without a request or DOM), and `npm run build && npm run start` was used to confirm every `/dev/*` route 404s in a production server while `/`, `/login` and `/admin/login` still render.

**Login presentations** (`src/components/shared/login-presentation.tsx`, shared by `/login` and `/admin/login`): password fields default-visible with a "Login with OTP" secondary action for players only; the admin variant swaps copy/iconography but has no secondary path. Both forms `preventDefault` on submit and the submit button is disabled — there is no signup/register/create-account entry point anywhere in the player or admin surfaces, and no authentication call executes.

**Dependencies**: Radix (`dialog`, `alert-dialog`, `tabs`, `dropdown-menu`, `toast`) is the sole overlay/menu/tabs primitive layer, `lucide-react` the sole icon set — no competing UI kit was introduced. `@testing-library/react`, `@testing-library/user-event` and `jsdom` were deliberately **not** installed: the interactions worth covering in Window 2A (countdown formatting, nav active-state matching, the dev/production route guard) are pure functions or context-free `notFound()` calls that a plain Node `vitest` environment already exercises without a DOM, so the dependency wasn't justified. Revisit this once a real interaction (form submission, ticket confirm flow) needs simulated user events.

## Window 2A-V and Window 3B implementation

This section supersedes the historical Window 1/2A palette and presentation-only auth notes above. The earlier visual implementation was not user-approved. This sprint replaces its material and composition system; it does not imply user visual sign-off.

### Material and typography

The palette is graphite `#0b0c0e`, raised charcoal `#191b1d`, pearl `#f3f1ec`, champagne `#d8c7a5`, muted sage `#a9cbb6` for success, and cool silver `#b8cbd0` for information. Champagne is restricted to primary actions, selected numbers, results and small identity details. Background lighting combines low-opacity sage and warm reflections behind surfaces. No oversaturated blue/purple or continuous ambient animation.

Glass is now visibly translucent: subtle `#26292b45`, default `#26292b85`, strong `#272a2bd6`, with a common internal highlight layer, 16–40px backdrop blur, restrained top-edge light and deeper shadows. Tables retain opaque charcoal for reading. Cards use 24px radii, primary panels 28px, controls 10–14px. The existing licensed Geist Sans/Mono font setup stays; tighter display tracking, lighter display weights, calmer labels and isolated monospace result/countdown typography create hierarchy without another network font dependency.

Login uses an asymmetric desktop composition with a quiet faceted aperture behind the story and a separate frosted form. At phone widths, the composition becomes a focused full-width form with restrained atmospheric light. Password/OTP state, API requests, redirects and role protection remain unchanged.

Shared buttons use tactile highlights and the existing reduced-motion-aware press spring. Inputs become recessed glass wells with visible focus. Tabs receive a raised segmented control treatment. NumberTile has a solid champagne selected state. Modal, BottomSheet, Drawer, Toast and profile menu share layered blur; Radix retains focus trapping, Escape dismissal and focus return. Admin navigation uses a quiet opaque/translucent rail with denser reading surfaces.

### TicketSurface

The reusable receipt remains presentation-only: frosted paper/glass with a warm internal light, strong total hierarchy, dashed section dividers and a 7px bottom edge with approximately 1.5px notches. No zigzag, fabricated receipt ID, placement flow or export action. Print CSS makes the receipt white with dark readable text, neutral dividers, no blur or shadows and avoids internal page breaks. Real receipt data and downloads remain deferred.

### Player compositions

Home pairs a greeting/market entry with a compact available-balance panel. Market cards use three columns on large screens, two below 1200px and a single deliberate stack below 768px. Results use the same card hierarchy with business-date groups. The compact Home results strip adapts from six to three to two columns. Market detail pairs a schedule/countdown panel with a separate availability explanation; phone layouts stack those panels. Explicit dates on every market card and detail timing prevent overnight close ambiguity.

The existing desktop navigation remains Home / Results / My Bets / Wallet plus balance and profile. Mobile has Home / Results / central Play / My Bets / Wallet; Play links to `/markets`, and `/play` redirects there. Mobile navigation retains safe-area padding and 44px+ targets. My Bets and Wallet destinations are clearly labelled future-release placeholders, not full later-window pages.

### Frontend data decisions

`src/lib/ui/use-player-api.ts` is a narrow authenticated GET hook, not a new domain layer. It consumes the existing JSON envelopes with no-store requests, aborts superseded requests, times out after 15 seconds, refreshes visible pages every 30 seconds and on return to the page, and redirects expired sessions to login. Failed refreshes remove stale data and expose retry; changing a results query cannot display data from the previous query. DTO types use erased type-only imports from the existing backend, without bundling services into the browser.

Wallet data is read once by the protected player account provider and shared with Home and the header. Available/reserved paise are never recalculated; Money uses the existing exact formatter. Countdown accepts an API `serverNow` and a monotonic receipt timestamp, then advances by elapsed time. It never determines operational state or betting eligibility. Status may be up to 30 seconds old between successful refreshes; no placement UI is enabled from that state.

The live app verification uses an isolated, disposable local MongoDB replica set and synthetic QA accounts/results. The configured `.env` and database are untouched. Synthetic records are confined to this QA environment; production-facing pages always read real API responses. Backend/API/domain files remain unchanged.

### Verification checkpoint — 2026-09-06

- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS, no warnings.
- `npm.cmd test`: PASS, 178 tests across 15 files (173 baseline plus five presentation tests covering server-owned cutoff selection, explicit overnight dates and lifecycle labels).
- `npm.cmd run build`: PASS, all new player routes registered.
- `git diff --check`: PASS (only Git's informational LF/CRLF conversion warnings).
- Real application HTTP checks on port 3799 with an isolated replica set: anonymous markets 401; player password login 200; authenticated Home, selector, Disawar detail and Results HTML 200; market list/detail, today, 7-day market-filtered results, 30-day results and wallet APIs 200. Historical `00`, `07` and `99` remained strings. Wallet response is the actual zero-balance test wallet.
- At this historical checkpoint, browser visual/interaction QA was pending because built-in computer use had no browser. The recovered local Playwright evidence and completed browser audit below supersede that pending status.

### Recovery and completed browser audit — 2026-09-07

**Window 2A-V COMPLETE; Window 3B COMPLETE.** This records implementation and browser-QA completion, not user visual sign-off. Window 4B has not started.

Recovery began on `codex-frontend` with a clean working tree. The prior sprint was already checkpoint committed as `a2f782e` (`wip: checkpoint codex visual rework and player frontend`). Its 24-file frontend implementation was preserved; no reset, restore, checkout-over, redesign restart or backend merge occurred. Work stayed in `D:\Projects\Diamond`; `D:\Projects\Diamond-Claude` was untouched.

The previous session's ignored `node_modules/.cache/diamond-visual/` directory retained 44 route/viewport capture records and screenshots, a 15-check passing interaction report, and the running disposable MongoDB replica-set fixture on port 3799. These recovered records confirm the earlier login refinements, results filters, leading zeros, navigation, overlay focus, hover/press, reduced-motion and hydration checks. They were inspected and reused rather than treated as missing implementation. The fixture uses synthetic QA accounts and historical results; `.env` and the configured database were not changed or seeded.

#### Browser and exact coverage

Used cached Playwright 1.61.1 and cached Chromium 149.0.7827.55. No browser or persistent testing dependency was installed. The authenticated application used its existing API routes and disposable database. Failure, delay, empty-list and disabled-market edge cases used browser request interception only; no API or database-model changes were made to create these states.

Final rendered captures and horizontal-overflow assertions covered every row below at **1440×1000, 768×1024, 375×812 and 320×812 CSS pixels** (36 route/viewport combinations):

| Surface | Route(s) | Verification |
| --- | --- | --- |
| Player/admin login | `/login`, `/admin/login` | Desktop split and phone form, typography, glass, input/submit layout |
| Player Home | `/` | Greeting, real wallet balance, market grid, today's results, shell |
| Market selector | `/markets` | Cards, dates, status, availability filters, countdowns |
| Normal and overnight detail | `/markets/gali`, `/markets/disawar` | Schedule hierarchy, explicit next-day close, availability panel |
| Results | `/results`, `/results?range=7d` | Pending and declared values, dates, cards, market/range controls; `00` and `07` preserved |
| Shared design system | `/dev/design-system` | Tokens, typography, glass, controls, feedback and presentation-only ticket |

No horizontal document overflow occurred in those captures or in the state/safe-area captures. Final screenshot comparisons retained the existing graphite/champagne palette, restrained internal reflections, distinct glass layers, readable numeric hierarchy and deliberate tablet/phone layouts. TicketSurface was captured separately at all four widths: warm glass, clear total, dashed sections and subtle bottom perforation. It remains a labelled sample, with no placement, receipt reference or final ticket workflow.

#### Loading, errors and empty content

- At all four widths, delayed market-list, market-detail and results requests displayed labelled page skeletons. HTTP 503 responses displayed readable errors and retry actions. Retrying displayed pending feedback and returned to real API data after success.
- Empty market lists and empty results history displayed their respective empty states at all four widths. Home separately displayed no-market/no-result content alongside a wallet error. The open-now empty state offered the all-markets recovery action.
- At 320×812, a real unknown-market API response rendered "Market not found" and recovered through "Back to markets". An intercepted disabled/no-round DTO rendered "Market unavailable". A failed results-filter request recovered through "Retry filters".
- An aborted network request and a response delayed beyond the existing 15-second timeout produced the connection-interrupted state. Network-error retry recovered successfully. Neither scenario produced an uncaught page error.
- At 320×812, wallet initial load and failed-read retry displayed "Loading balance…", then the real zero balance. Both login portals showed a disabled, busy submit button and spinner during delayed real login requests, followed by the real invalid-credentials alert.

#### Safe areas and mobile emulation

Touch/mobile Chromium emulation used device scale factor 3 and actual CDP `Emulation.setSafeAreaInsetsOverride` values, rather than assuming desktop zero insets prove notch support:

| CSS viewport | Insets (top / right / bottom / left) | Observed after fix |
| --- | --- | --- |
| 375×812 | 44 / 0 / 34 / 0 px | Header top padding 44px; bottom-nav clearance 34px |
| 320×812 | 44 / 0 / 34 / 0 px | Header top padding 44px; bottom-nav clearance 34px |
| 812×375 landscape | 0 / 44 / 21 / 44 px | Header/content left clearance 44px; bottom-nav clearance 21px |

All five mobile navigation targets measured at least 44×44px (smallest observed approximately 49×56px). At the end of the market list, the final content sat above the bottom bar after scrolling. Sheets retained safe bottom padding, fit the emulated viewport and dismissed normally. Both login brands cleared the 44px portrait top inset. Browser viewport output includes `viewport-fit=cover`; zoom is not disabled. These are Chromium emulation checks, not physical iPhone/Safari verification.

#### Accessibility and final regressions

At 320×812, modal, sheet and drawer placed initial focus on their heading, trapped repeated Tab navigation, closed on Escape and restored focus to the trigger. The skip link moved focus to the player main content. All five player navigation destinations and `aria-current` states were checked, including the existing My Bets/Wallet placeholders. No later-window UI was added.

Reduced-motion verification retained no press transform and the existing 0.00001-second skeleton animation backstop. The countdown advanced using its existing server anchor and retained `role="timer"` / `aria-live="off"`. The final regression pass reported no hydration, console or uncaught page errors. Earlier recovered evidence also covers visible login keyboard focus, dropdown focus return, keyboard tabs, number selection, toast dismissal, normal-motion hover/press and successful real player login.

QA-only harness corrections were required for a hidden native `<option>` (assert attachment, not visibility), the ticket's actual `.ticket` selector, and the development-only Next.js badge intercepting the Home click. The final interaction harness hides only `nextjs-portal`, as the previous session did; product source/configuration was not changed to hide development tooling. Those harness failures were not application defects.

#### Defects fixed during recovery

1. **Incomplete notch handling.** The rendered viewport omitted `viewport-fit=cover`. With nonzero insets, the login brand began at 24px beneath a 44px top exclusion, and landscape header/content began at 20px/32px beneath a 44px side exclusion. Added the supported static Next.js viewport export and safe-area-aware container, header, login, navigation and overlay gutters. Existing zero-inset spacing is preserved; the browser theme color matches graphite.
2. **Retry lacked pending feedback.** During a delayed retry after failure, the error and active retry button remained visible with no loading indicator. The existing authenticated GET hook now enters its loading state when no current data exists. Successful background refreshes retain their current content. API contracts, polling interval, timeout, abort handling and authentication behavior are unchanged.
3. **Tablet ticket specimen compressed labels.** A separate 768px ticket capture exposed mid-word wrapping in "Market" and "Total amount" despite no document overflow. The showcase's tablet hero now reserves a 352px minimum ticket column and uses a 32px gap. The shared ticket and player layouts are unchanged; final captures verify readable labels at all four widths.

No unresolved application defects were observed within this scope. Backend/domain/API/auth files, market scheduling, Mongo models, betting engines, wallet/withdrawal services and backend handoff documents are unchanged. Window 4B, full My Bets, wallet/withdrawal UI, admin CRUD and final ticket workflow remain deferred.

#### Final quality gates and evidence

| Command | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS; route type generation and strict TypeScript |
| `npm.cmd run lint` | PASS; no warnings/errors |
| `npm.cmd test` | PASS; 178 tests across 15 files |
| `npm.cmd run build` | PASS; Next.js 16.3.4 production build and route generation |
| `git diff --check` | PASS; only informational LF/CRLF conversion notices |

PowerShell used `npm.cmd` for the requested npm scripts. No live database seed/reset/check or additional backend integration run was needed for these presentation fixes. Local ignored evidence remains under `node_modules/.cache/diamond-visual/recovery/`: `report.json` (36 viewport checks, 13 state records, three nonzero safe-area configurations, zero page errors), `regression-report.json`, final page/state screenshots, comparison sheets and ticket/overlay captures. Earlier `capture-report.json` and `interaction-report.json` remain intact in the parent directory. These local artifacts are not committed or required to build the app.
