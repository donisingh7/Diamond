# Player experience

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
