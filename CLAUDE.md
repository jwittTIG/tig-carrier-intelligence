# CLAUDE.md — TIG Carrier Intelligence

Read this file at the start of every session. It overrides convenience.

## Mission
A secure internal web app for The Insurance Group (TIG), an independent commercial P&C agency, to manage **property & casualty** carrier intelligence: carrier and intermediary relationships, appetite, underwriter contacts, agency appointments and codes, commission schedules, documents, and verification workflows.

**Excluded entirely:** life, health, employee benefits, disability, long-term care, medical plans, enrollment, and health-related underwriting. Do not seed, build forms for, or introduce these lines (`src/lib/taxonomy/scope.ts` guards line names).

## Product contract
- `docs/PRD.md`, `docs/DATA_MODEL.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/ACCEPTANCE_TESTS.md`: Josh's blueprint (v2.0, 2026-11-04). Read before coding.
- `docs/DECISIONS.md`: confirmed and proposed decisions, and where the schema differs from the blueprint. **Decisions there override the blueprint** (notably D1: everyone sees everything).
- `docs/PROGRESS.md`: current status. `prompts/`: one prompt per milestone.
- `docs/blueprint/`: the blueprint's original README and CLAUDE.md, kept for reference.

## Working rules
1. Work one milestone at a time using its prompt in `prompts/`. Do not start the next milestone until the current one meets its definition of done **and Josh has reviewed it**.
2. Before coding, read `docs/PROGRESS.md` and `docs/DECISIONS.md`. Before ending a session, update `docs/PROGRESS.md` (done / tested / not tested / remaining / open questions).
3. Anything marked `PROPOSED` in DECISIONS.md needs Josh's confirmation before you build on it. To change a confirmed decision, stop and explain why first.
4. Never claim a test, integration or feature works unless you ran it and saw it work. Say "not tested" when that is true. Report exact commands and failures.
5. No buttons that do nothing and no hardcoded dashboard numbers. Hide or clearly label unfinished things.
6. Services without credentials get a labeled dev adapter that refuses to run when `NODE_ENV=production`. Document the blocker rather than guessing.
7. Small, reviewable commits. Run `npm run check` before each commit. Schema changes and security logic need Josh's review.
8. Never wipe or reset a database without Josh's explicit OK in this session (the test suite resets only the local test DB; see DECISIONS N10).

## Domain rules (from the blueprint)
- Keep organization → writing company / intermediary → carrier product → market channel as distinct concepts. Agency appointments belong to agency legal entities and channels.
- Commission schedules and appetite rules are effective-dated, source-backed and approval-controlled. Approved records keep prior versions.
- Unknown appetite is never "eligible". Carrier appetite never means binding authority, and market matching never implies coverage is bound or eligibility is guaranteed.
- Never store carrier portal passwords or other credentials.
- Every business change writes an immutable `audit_events` row (append-only, enforced by trigger) in the same transaction.
- AI extraction is P2. When built, AI suggestions never publish without human approval and always carry provenance (document, page, quote, confidence).
- Money and rates are `Decimal`, never floating point. Commission `rate` is a fraction (0.125 = 12.5%).
- Authorization is enforced on the server for every read and write, never by hiding UI.

## Data handling
- Synthetic fixtures only, prefixed `DEMO` (seed) or `TEST` (tests), emails `@example.invalid`. Never invent or commit real TIG carrier data, agency codes, commission rates or employee contacts.
- Secrets only in environment variables; keep `.env.example` current. Documents go to private storage by object key; access through short-lived signed URLs after a permission check.

## Commands
- Install: `npm install` (runs `prisma generate`)
- Local databases: `npm run db:start` (starts the `tci` and `tci-test` prisma dev servers; see README and DECISIONS D7a)
- Migrate / seed dev DB: `npm run db:migrate` · `npm run db:seed` · new migration: `npm run db:migrate:dev -- --name <name>`
- Dev server: `npm run dev`
- Lint / typecheck / tests / build: `npm run lint` · `npm run typecheck` · `npm test` (resets the test DB first) · `npm run build`
- Search timing: `npm run test:perf` (separate from `npm test`)
- E2E: `npm run test:e2e` (dev DB + dev sign-in; first time `npx playwright install chromium`)
- Everything before a commit: `npm run check`

## Codebase conventions
- Next.js 16: read `node_modules/next/dist/docs/` before using an unfamiliar API (see AGENTS.md). `middleware` is now `proxy.ts`.
- Prisma client is generated to `src/generated/prisma`; import from `@/generated/prisma/client`. App code uses `@/lib/db/client` (server-only).
- Postgres tables/columns are snake_case (`@@map`/`@map`), Prisma fields camelCase.
- Constraints Prisma can't express go in SQL migrations, each with a test in `tests/integration/`.
- Auth: services take an `AuthContext` and call `assertCan` first. Pages and actions call `requireAuth()`; API routes wrap handlers in `apiHandler()`. Every write calls `recordAudit(tx, ctx, ...)` inside its transaction.
- Server actions return `ActionState` through `runAction()`; forms use `<ActionForm>`.
