# Diamond

Window 1 foundation for a scheduled two-digit betting prototype. Next.js App Router,
strict TypeScript, MongoDB/Mongoose and a modular monolith. Only a holding page is
exposed; authentication, betting, wallet operations and admin screens are later windows.

Start every implementation window with [docs/CODEX_RULES.md](docs/CODEX_RULES.md).
Read the [product specification](docs/PRODUCT_SPEC.md), [frozen domain rules](docs/DOMAIN_RULES.md),
[architecture](docs/ARCHITECTURE.md), [database guide](docs/DATABASE.md), and
[nine-window roadmap](docs/ROADMAP.md). The eleven files in [docs](docs) are the durable handoff.

## Developer setup

1. Install Node **24 LTS, >=24.13.0**, with npm. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`; do not change execution policy.
2. Run `npm ci` from the repository root.
3. Create `.env.local` using [.env.example](.env.example) as a guide, preserving any existing `.env`. Shell values take precedence, then `.env.local`, then `.env`. Never commit secrets.
4. Set `MONGODB_URI` to an explicit database on **MongoDB Atlas or a local replica set**. A standalone server cannot support the required financial transactions. See [local replica-set setup](docs/DATABASE.md).
5. Set `SEED_ADMIN_LOGIN_ID` and a unique `SEED_ADMIN_PASSWORD` (12–1024 characters). Set `SESSION_SECRET` to at least 32 random characters for OTP/session-related operations. For example, generate a secret locally with `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"`; keep the output private.
6. Run `npm run db:check`, then `npm run db:seed`. Seed provisions indexes, inserts missing settings and six markets, and creates a missing admin. Existing admin passwords/status and market/settings edits are preserved. It does not credit wallets or create sample bets.
7. Run `npm run dev` and open [localhost:3000](http://localhost:3000).

Geist is loaded through `next/font/google`; a cold build needs access to Google Fonts.
Database environment validation is lazy, so the holding page, unit tests and build do
not require database access. Auth is not yet exposed even after the admin is seeded.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run typecheck` | Generate Next route types and check strict TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Offline unit/schema tests |
| `npm run test:watch` | Watch unit tests |
| `npm run test:integration` | Disposable local MongoDB replica-set tests; first run downloads a MongoDB binary |
| `npm run build` | Production build |
| `npm start` | Serve production build |
| `npm run db:check` | Mongoose connection, replica-set topology and transactional read |
| `npm run db:test` | Original MongoDB driver ping diagnostic using `.env` |
| `npm run db:seed` | Add missing foundation data and admin, preserve existing values |
| `npm run db:create-admin` | Independently ensure an environment-defined initial admin |
| `npm run db:provision` | Non-destructive: ensure all 12 canonical collections exist (visible in Atlas/Explorer even when empty), ensure indexes, ensure foundation markets/settings. Never drops a collection or index, never touches user data. Safe to rerun. |
| `npm run db:seed-demo` | Guarded demo deployment seed — **requires `DEMO_SEED_ENABLED=true`** plus the demo passwords in the environment; never runs on app startup. Creates `test1` (PLAYER) + three ADMIN accounts, hashed; the demo player's ₹10,000 opening balance is a keyed `ADMIN_CREDIT` movement, not a direct write. Deterministic, idempotent, non-destructive; aborts with no writes if a login id already exists with a different role. |
| `npm run db:reset -- --confirm diamond_dev` | Clear known development collections; see safeguards below |

Reset additionally requires explicit `NODE_ENV=development` and a connected database
named `diamond_dev` or `diamond_dev_<suffix>` matching the confirmation exactly.
Stop application writers first. Never use reset as a normal seed/check step. It preserves
indexes and unrelated collections but deletes all data in known app collections.

No real payment/SMS integrations, public signup, Redux, microservices or production
infrastructure are included. Money-in in V1 is **manual**: a player pays the admin outside
Diamond, the admin verifies it, then credits the wallet via the admin API, recording an
immutable `ADMIN_CREDIT` — there is no payment gateway (see
[ADMIN_SPEC.md](docs/ADMIN_SPEC.md) and [DOMAIN_RULES.md](docs/DOMAIN_RULES.md)). React Hook
Form and shadcn primitives are deferred until Window 2 forms/components need them. See
[security obligations](docs/SECURITY_AND_AUTH.md) before exposing any authenticated route.

## DNS troubleshooting on this workstation

The original ping script's process-local DNS fallback succeeds here, while the system
resolver cannot resolve Atlas SRV records. Application/seed scripts intentionally do not
silently choose public DNS. If needed, add `MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` to your
local environment, or use suitable resolver IPs for your network. This opt-in changes
Node DNS for that server process, not system DNS. The Mongoose transaction check has
been verified with this explicit setting. No existing `.env` values were changed.

The current verification record and remaining local setup are in [the Window 1 handoff](docs/ROADMAP.md#verification-record--2026-09-06). The integration suite pins MongoDB 8.2.6, caches its binary under node_modules/.cache, and allows up to 15 minutes for cold setup; ordinary npm installation and unit tests do not download MongoDB.
