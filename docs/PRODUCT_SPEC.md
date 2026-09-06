# Product specification

Read [CODEX_RULES.md](CODEX_RULES.md) first. These requirements are authoritative and originate from the approved Window 1 brief. DOMAIN_RULES.md owns business rules; the roadmap limits implementation scope. Future-facing descriptions do not imply implemented features.

## PROJECT PURPOSE

We are building a **prototype betting website** using Next.js.

The reference product was originally a mobile application, but this project is a new premium responsive website.

The reference application's functionality is useful as a business-flow reference only.

Do NOT copy its visual design.

This prototype currently supports one betting domain based around scheduled markets and 2-digit results.

Future architecture should allow additional game domains/modules such as sports or casino without forcing the current betting module to be rewritten, but:

**DO NOT IMPLEMENT SPORTS, CASINO, SLOTS, OR OTHER FUTURE GAME TYPES NOW.**

Avoid premature abstraction and avoid microservices.

Use a **clean modular monolith**.

## TECHNOLOGY STACK — FREEZE THIS

Use:

* Next.js with App Router
* TypeScript with strict mode
* MongoDB
* Mongoose
* Zod
* Tailwind CSS
* shadcn/ui where it improves primitives, without letting it dictate visual identity
* Motion / Framer Motion for future motion and interaction work
* React Hook Form where forms benefit from it
* Server-side/domain services for business logic

Do NOT add Redux unless an actual future requirement justifies it.

Use local state/server state appropriately.

Use ESLint and the project's available formatting conventions.

## DO NOT IMPLEMENT IN WINDOW 1

Explicitly do NOT build:

* complete Player Dashboard
* complete market cards
* Jodi UI
* Crossing UI
* Copy Paste UI
* full bet slip
* final ticket UX
* full Wallet UI
* full Withdrawal UI
* Results UI
* My Bets UI
* complete Admin screens
* settlement UI
* real payment gateway
* real SMS
* KYC
* AML
* sports
* casino
* slots
* microservices
* production infrastructure
* complex admin RBAC

Skeleton route/layout placeholders are acceptable only if they improve architecture.

Do not create fake complete features merely to make screenshots look finished.

## Current scope

The repository is named Diamond. This is a prototype of the scheduled two-digit market domain only. The holding page is intentionally minimal. Documentation describes the eventual product; implemented scope is recorded in ROADMAP.md. No real payments/SMS, public registration, sports/casino/slots or production-only infrastructure is implemented.
