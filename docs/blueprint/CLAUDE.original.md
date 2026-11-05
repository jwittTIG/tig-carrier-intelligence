# TIG Carrier Intelligence — Claude Code Development Instructions

## Mission
Build a secure, production-oriented internal web application for The Insurance Group (TIG) to manage **property & casualty insurance** carrier intelligence: carrier and intermediary relationships, appetite, underwriter contacts, agency appointments and codes, commission schedules, documents, and verification workflows.

**Excluded entirely:** life, health, employee benefits, disability, long-term care, medical plans, enrollment, and health-related underwriting information. Do not seed, build forms for, or introduce these lines.

Read `PRD.md`, `DATA_MODEL.md`, `IMPLEMENTATION_PLAN.md`, and `ACCEPTANCE_TESTS.md` before coding. Treat them as the product contract. Where requirements are unspecified, make conservative choices, document them in `DECISIONS.md`, and do not invent TIG carrier data, agency codes, commission rates, or employee contacts.

## Stack (proposed default)
- Next.js App Router + TypeScript + React
- PostgreSQL + Prisma ORM and migrations
- Tailwind CSS + accessible component primitives
- Auth.js / OIDC with enterprise identity provider adapter; use development-only local auth only if explicitly enabled
- Zod validation; server-side authorization for every read/write
- Object storage abstraction for private files (S3-compatible); local dev adapter
- Vitest unit/integration tests + Playwright end-to-end tests
- Docker Compose for local PostgreSQL; `.env.example` with no secrets

## Engineering rules
1. Build MVP only unless explicitly asked for a later phase.
2. Implement schema/migrations and authorization before feature screens.
3. Use organization -> writing company / intermediary -> carrier product -> market channel as distinct concepts. Agency appointments belong to agency legal entities and channels.
4. Commission schedules and appetite rules must be effective-dated, source-backed, and approval-controlled.
5. Never store carrier portal passwords in the application database.
6. Restrict commission amounts and agreements by permission. Never rely on hidden UI controls for access control.
7. All business changes create immutable audit events; approved record revisions retain history.
8. AI extraction is out of MVP; later AI suggestions must never auto-publish without human approval.
9. Never imply that market matching means coverage is bound or eligibility is guaranteed.
10. Use synthetic fixtures only, clearly marked DEMO. Never invent actual TIG operational data.
11. Maintain a changelog and test results after each milestone.
12. If dependencies or provider credentials are missing, implement a clean interface/mock adapter and document the blocker rather than guessing.

## First tasks
1. Inspect repo; if empty, scaffold application.
2. Implement schema, constraints, seed taxonomy, and migration tests.
3. Implement OIDC auth abstraction, roles, agency-entity scoping, and audit middleware.
4. Implement carrier directory, profile tabs, contact management, appointments/codes, commission schedules, appetite profiles, documents, search, verification, and CSV import.
5. Run automated tests, lint, typecheck, and production build. Report exact commands and failures.

## Definition of done
All P0 acceptance tests in `ACCEPTANCE_TESTS.md` pass; no known critical authorization failures; README includes setup, migrations, seed, environment variables, testing, backup/restore guidance, and deployment prerequisites. Do not claim production readiness until real security review and TIG stakeholder acceptance are complete.
