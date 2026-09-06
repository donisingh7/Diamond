# Rules for every implementation window

Read [CODEX_RULES.md](CODEX_RULES.md) first. These requirements are authoritative and originate from the approved Window 1 brief. DOMAIN_RULES.md owns business rules; the roadmap limits implementation scope. Future-facing descriptions do not imply implemented features.

## CODEX_RULES.md — CRITICAL

Create `/docs/CODEX_RULES.md` and make it explicitly state that every future implementation window must:

1. Read CODEX_RULES.md first.
2. Read all documentation relevant to the requested task.
3. Inspect the existing repository before changing code.
4. Run existing checks before major changes where practical.
5. Never invent or silently modify business rules.
6. Never add public player registration.
7. Never hardcode market timings in UI components.
8. Treat server calculations as authoritative.
9. Never trust totals, payout, selection counts, balances, market status, or edit eligibility supplied by the browser.
10. Never mutate wallet balances outside the wallet domain/service.
11. Preserve bet revision history.
12. Use MongoDB transactions for atomic financial operations where required.
13. Make financial actions idempotent where duplicate requests could move money twice.
14. Keep business logic out of presentation components.
15. Reuse the shared design system.
16. Support desktop and mobile as deliberately designed responsive compositions.
17. Preserve strict TypeScript.
18. Do not introduce microservices.
19. Do not introduce unnecessary abstractions.
20. Do not add production-only features unless explicitly requested.
21. Do not implement real payment processing in prototype.
22. Do not implement real SMS in prototype.
23. Never expose raw password values.
24. Never expose MongoDB ObjectIds as the user-facing bet reference.
25. Update relevant docs when an approved technical clarification changes implementation.
26. If requested work conflicts with authoritative docs, surface the conflict instead of silently choosing a new business rule.

## WORKING MODE

Before making changes:

1. Inspect the entire current repository.
2. Determine whether this is an empty/new Next.js project or an existing project.
3. Preserve useful existing work.
4. Do not blindly overwrite existing configuration.
5. Check package.json, TypeScript config, app structure, environment files, git status, and existing dependencies.
6. Read any existing documentation before changing architecture.
7. Do not invent business rules beyond those explicitly defined in this prompt.

If something is technically ambiguous but does NOT affect a frozen product/business rule, choose the cleanest maintainable implementation and document the decision.

If an existing implementation directly conflicts with the frozen requirements below, refactor toward this specification.

## QUALITY GATES

By the end of this window run all applicable:

```text
typecheck
lint
tests
production build
```

Fix errors introduced by your work.

Do not hide errors with:

```text
any
@ts-ignore
eslint-disable everywhere
```

unless there is a very specific justified reason.

Strict TypeScript is required.

## Repository entry point and authority

Root AGENTS.md points here. Read this file first in every fresh window. DOMAIN_RULES.md is canonical for frozen business behavior; ROADMAP.md limits sequencing. Other documents reproduce relevant frozen requirements and add explicitly labeled implementation decisions. In a discrepancy, surface the conflict to the user instead of silently changing a rule. Technical changes require corresponding documentation updates.

Before finishing a coding window, run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. On PowerShell systems blocking npm.ps1, use `npm.cmd` without changing execution policy. Database-dependent checks are separate: `npm run db:check` needs configured transaction-capable MongoDB. Record exact verification results and environment blockers; never claim a live database/seed check ran if it did not.

Do not change `.env` or reveal its values in logs. Keep `.env.example` blank/safe. Do not execute development reset as a normal verification step. Do not overwrite pre-existing uncommitted work. Keep deferred services as types/docs, not dummy successful implementations.
