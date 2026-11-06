# TIG Carrier Intelligence

Internal web app for The Insurance Group's P&C market relationships: carriers and intermediaries, appetite, underwriter contacts, agency appointments and codes, commission schedules, documents and verification. **P&C only** (no life, health, benefits, disability or LTC).

Status: **Milestone 5 (MVP release candidate)**: search, import, dashboard, hardening. See `docs/PROGRESS.md`.

Docs: `docs/PRD.md` · `docs/DATA_MODEL.md` · `docs/IMPLEMENTATION_PLAN.md` · `docs/ACCEPTANCE_TESTS.md` · `docs/ACCEPTANCE_STATUS.md` · `docs/DECISIONS.md` · `docs/SECURITY.md` · `docs/OPERATIONS.md` · `docs/UAT.md` · `CLAUDE.md`

## Prerequisites
- Node.js 24+, npm 11+, git
- No Docker or Postgres install needed locally: two `prisma dev` servers run Postgres 17 (PGlite) on this machine (DECISIONS D7).

## First-time setup
```bash
npm install
cp .env.example .env.local
npx prisma dev -n tci --detach        # dev database
npx prisma dev -n tci-test --detach   # test database
npx prisma dev ls                     # check the TCP ports match .env.local
npm run db:migrate
npm run db:seed
npm run dev                           # http://localhost:3000 and /api/health
```
`prisma dev ls` prints each server's `postgres://…@localhost:<port>/template1` URL. If the ports differ from `.env.example`, update these in `.env.local`:
- `DATABASE_URL`;
- `SHADOW_DATABASE_URL` (the dev server's shadow port);
- `TEST_DATABASE_URL`.

Later sessions: `npm run db:start`, then `npm run dev`.

## Environment variables
See `.env.example`:
- `DATABASE_URL`: the app database.
- `SHADOW_DATABASE_URL`: only used by `prisma migrate dev`.
- `TEST_DATABASE_URL`: wiped on every test run. It must be local and different from `DATABASE_URL`.
- `DATABASE_POOL_MAX`: connection-pool cap. Keep it at `1` for local `prisma dev`, which is unstable with concurrent connections (DECISIONS D7a).
- `PRISMA_DEV_TEST_SERVER`: name of the local test server; `npm test` restarts it before each run. Leave it unset for real Postgres.
- `AUTH_DRIVER`: `clerk` (Microsoft 365 through Clerk) or `dev` (development-only sign-in, refused in production).
- `ALLOWED_EMAIL_DOMAINS`: who can be invited and sign in.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`: Clerk keys for this app. Not set yet.
- `STORAGE_DRIVER` / `DEV_STORAGE_DIR`: document storage, used from Milestone 4.

## Signing in
- **Now:** `AUTH_DRIVER=dev`. `/sign-in` lists the seeded DEMO users (DEMO Admin, DEMO Producer). A yellow banner shows on every page while this is on.
- **Later:** `AUTH_DRIVER=clerk`. Staff sign in with Microsoft 365. Access is invite-only: an admin invites them on **Users** first (DECISIONS D18).

## Migrations and seed
- Apply: `npm run db:migrate` · Create: `npm run db:migrate:dev -- --name <name>`
- Constraints Prisma can't express live in `prisma/migrations/*_constraints/migration.sql`: date-order checks, overlap-exclusion constraints, partial unique indexes, trigram indexes and the append-only audit trigger.
- `npm run db:seed` is safe to run repeatedly. It adds:
  - the P&C line taxonomy;
  - US states;
  - roles and permissions;
  - settings;
  - fictional `DEMO` records (`SEED_DEMO=0` skips these).

## Testing
- `npm test`: Vitest unit + integration tests. **It wipes and rebuilds the test database** (`TEST_DATABASE_URL`) before running.
- `npm run test:e2e`: Playwright smoke test (run `npx playwright install chromium` once).
- `npm run test:perf`: search timing on 300 fictional carriers (run on its own; it loads thousands of rows).
- `npm run check`: lint + typecheck + tests + build.
- On this PC, PowerShell blocks `npm.ps1`: type `npm.cmd` instead of `npm` (e.g. `npm.cmd run dev`).

## Backup, restore and deployment
See `docs/OPERATIONS.md` and `docs/SECURITY.md`.

## Backup and restore (to finish before go-live)
Local `prisma dev` data is disposable. Production (DECISIONS D8, proposed Neon) needs daily backups plus point-in-time restore. A restore drill must be recorded in `docs/PROGRESS.md` before real data goes in. The PRD's proposed targets are RPO 1 hour and RTO 4 hours.

## Deployment prerequisites (not done)
Before deploying, these must be in place:
- confirmed hosting (D8);
- confirmed identity provider (D9);
- a private storage bucket (D11);
- a GitHub remote with CI (D10);
- a security review.

Do not treat this as production-ready until TIG stakeholders accept it.

## Troubleshooting
- **The sign-in page keeps reloading by itself and you can't sign in:** the dev server's build cache is in a bad state. Stop the server (Ctrl-C), delete the `.next` folder, and start it again with `npm.cmd run dev`. The folder holds no data and is rebuilt automatically.
- **`npm` fails in PowerShell with "running scripts is disabled":** use `npm.cmd` instead of `npm`.
- **Tests fail with "Connection terminated unexpectedly":** the local test database (PGlite) crashed. Run `npm test` again; it restarts that server first. Moving to real Postgres fixes this for good (DECISIONS D7a).
