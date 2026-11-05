# Milestones 0 + 1: repo setup and data foundation

Status: built 2026-11-04, awaiting Josh's review.

## Build
- Next.js/TypeScript/Prisma/Postgres skeleton, env template, CI workflow, README.
- `/api/health` database check.
- Full Milestone 1 schema from `docs/DATA_MODEL.md`, minus the P1/P2 tables (DECISIONS N7), plus its SQL constraints.
- P&C seed and DEMO records.
- Migration tests.

## Definition of done
- Migrations apply cleanly to an empty database.
- The seed is safe to run repeatedly.
- Constraint tests pass.
- Lint, typecheck, tests and build pass.
- `docs/PROGRESS.md` is updated.
