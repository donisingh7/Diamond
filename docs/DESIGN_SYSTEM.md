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
