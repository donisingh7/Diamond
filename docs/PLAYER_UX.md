# Player experience

## Window 4B0 — appearance preference

The approved primary experience is **Light**: luminous pearl/white surfaces, dark readable typography, polished gold Play actions, emerald OPEN indicators and framed result numbers. Dark remains an optional charcoal/champagne adaptation of the same components. This supersedes historical dark-primary design notes; no frozen betting rule changes.

Players choose Light or Dark directly in the header, including login. Desktop shows sun/Light and moon/Dark; compact player headers use accessible icon buttons. Both targets remain at least 44×44px. On phones balance occupies its own row, preserving room for brand, appearance and Account. Bottom navigation and safe-area clearance remain.

An absent, invalid or inaccessible `diamond-theme` local preference renders Light even if the OS is Dark. Explicit selection persists across reloads/navigation/new tabs and synchronizes open tabs. Storage is UI-only, never authentication authority. A small root-head initializer applies preference before body paint; stable server markup and a hydration-safe external-store subscription keep React consistent. When storage is blocked, the switch works for the visit and reload returns to Light.

Home emphasizes the existing server balance and market lineup. Market cards distinguish OPEN, closing and unavailable states through text plus restrained color. View links still lead to market detail; Play still leads to selection. Results retain leading zeros. Loading, failure/retry, empty and unavailable states use the same semantic palettes. Keyboard focus, dialog focus return and reduced motion remain supported.

Window 4B builders, confirmation/success tickets and editing remain deferred. My Bets, Wallet and Admin operational pages retain their placeholder scope. See DESIGN_SYSTEM.md for token architecture and browser verification.

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

## PLAYER UX — DOCUMENT SCREEN INVENTORY

Document these player surfaces:

```text
/login

/
or /dashboard

/markets/[marketSlug]

/results

/my-bets
/my-bets/[bet]
/my-bets/[bet]/edit

/wins

/wallet
/wallet/add-money
/wallet/withdraw
/wallet/transactions

/profile
/game-rate
/how-to-play
```

Ticket preview/success should normally be an interaction state/modal/sheet rather than unnecessary separate routes.

Desktop market page:

```text
game builder left
sticky bet slip right
```

Mobile:

```text
builder
+
sticky bottom summary/action
+
bottom-sheet ticket/review experience
```

Do NOT implement all of these pages fully in Window 1.

Document them.

## Implementation status and data dependencies

Only a static holding page at `/` exists in Window 1. It does not claim login, account creation, balances, markets or a complete product. `/login` and the protected player shell arrive in Window 2. Use `/` for the eventual authenticated player home; `/dashboard` is not needed as a duplicate unless later routing work explicitly documents a reason.

Market builder and slip consume persisted round timings, configured current rate and server quotes; countdowns never decide eligibility. In the final hour, communicate that new bets remain available while existing bets cannot be edited. Preserve the original entry method and raw composition when loading an edit. The same publicRef survives all versions; display revision history from betRevisions.

Wallet presents available and reserved separately. Mock deposit clearly labels prototype credit, withdrawals visibly remain pending until decision, and cancel is available only while pending. My Bets, Wins, Results and transaction history derive from canonical collections. No separate wins/resultHistory/transactionHistory collections and no permanent stored ticket files.

## Window 3B — implemented player read experience

Authenticated `/` now shows the real player name, available wallet balance, market overview and today's operational results. `/markets` is the market selector (all/open-now); `/markets/[slug]` displays the persisted round's opening, editing cutoff and closing timestamps, server lifecycle state, countdown and separate betting availability. Explicit day/month information preserves the next-day close of an overnight round. No client market-time calculation, bet-entry controls or fake placement operation is introduced.

`/results` consumes `/api/results` with Today / 7 days / 30 days and optional market filtering from `/api/markets`. Filters are kept in URL parameters for direct links and browser history; changing filters never mixes old and new response data. Today means operational rounds, including the previous business date for a still-open overnight round. History shows only declared results in the server-selected calendar period. Result strings such as `00` and `07` render verbatim, while `null` is explicitly shown as no declared result. Loading, failure/retry, empty history and unknown-market states have distinct presentations.

The protected shell reads `/api/wallet` and shows the available balance; Home also explains any reserved balance separately. No full wallet/deposit/withdrawal page is implemented. `/wallet` and `/my-bets` are honest future-release destinations so navigation does not lead to 404s. The profile dropdown retains real logout. Mobile central Play and the old `/play` path lead to `/markets` until Window 4B.

Data refreshes every 30 seconds while visible and on return to the page. Countdowns use server time plus monotonic elapsed time, remain advisory, and never replace server eligibility checks. New bets remain server-allowed during CLOSING_SOON while editing is locked; the detail page explains this distinction without providing a bet form. Unknown markets display a recovery path to the selector. An expired API session returns the visitor to login.

Window 4B betting composition, bet editing, review/success receipts and downloads remain unimplemented. See DESIGN_SYSTEM.md's Window 2A-V / 3B section for material and responsive decisions and verification status.
