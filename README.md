# TIG Carrier Intelligence

Internal web app for The Insurance Group's P&C market relationships: carriers and intermediaries, appetite, underwriter contacts, agency appointments and codes, commission schedules, documents and verification. **P&C only** (no life, health, benefits, disability or LTC).

Status: **Milestone 1 (data foundation)**. No sign-in and no screens yet. See `docs/PROGRESS.md`.

Docs: `docs/PRD.md` · `docs/DATA_MODEL.md` · `docs/IMPLEMENTATION_PLAN.md` · `docs/ACCEPTANCE_TESTS.md` · `docs/DECISIONS.md` · `CLAUDE.md`

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
- `STORAGE_DRIVER` / `DEV_STORAGE_DIR`: document storage, used from Milestone 4.

Identity-provider variables arrive in Milestone 2.

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
- `npm run check`: lint + typecheck + tests + build.

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
