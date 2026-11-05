# Implementation Plan for Claude Code

## Milestone 0 — Discovery & repo setup
Confirm open decisions, initialize Next.js/TypeScript, PostgreSQL/Prisma, Docker Compose, environment template, CI (lint/typecheck/tests/build), README, error handling, logging. Establish naming conventions and ADR/DECISIONS.md.
Deliverable: runnable skeleton with database health check.

## Milestone 1 — Data foundation
Implement schema and migrations; seed P&C taxonomy; organization hierarchy, carrier products, market channels, agency entities, users/roles/scopes, audit events; migration tests. Do not build life/health/benefits entities.
Deliverable: DB schema, seed, tests.

## Milestone 2 — Security and carrier directory
OIDC auth abstraction; route/server-action authorization; scoped queries; carrier directory CRUD, organization relationships, carrier detail; activity logging.
Deliverable: protected carrier directory.

## Milestone 3 — Contacts, appointments, codes
Contacts and assignments; territory/product specialties; agency appointments and authorizations; agency codes; portal links; expiry/staleness indicators.
Deliverable: carrier relationship operations.

## Milestone 4 — Appetite, commissions, documents
Versioned appetite profile/rule editor with source links; effective dates and conflict warnings; restricted commission agreements/schedules; private documents/versioning; approvals; verification tasks.
Deliverable: usable MVP core.

## Milestone 5 — Search, import, hardening
Global search and filters; CSV mapping/preview/dedup/commit/error report; accessible responsive UI; audit viewer; permission regression tests; security and backup documentation; pilot UAT.
Deliverable: MVP release candidate.

## Later phases (do not implement without approval)
P1: risk matching, market comparison, submission workflow, notifications, AMS adapter, production dashboard, commission reconciliation.
P2: AI bulletin extraction, chat search, historical recommendations, contingent commission modeling, carrier feeds.

## Implementation discipline
For each milestone: plan -> implement -> migrate -> seed -> test -> lint -> typecheck -> build -> summarize changes, risks, and next steps. Keep PRs small. Record assumptions in DECISIONS.md. Require review for schema changes and security logic.

## Suggested folder structure
app/(authenticated)/dashboard, carriers, markets, contacts, appointments, commissions, documents, approvals, admin;
components/{ui,carriers,markets};
lib/{auth,db,permissions,validation,audit,storage,search,imports};
prisma/{schema.prisma,migrations,seed.ts};
tests/{unit,integration,e2e};
docs/{api,decisions,operations}.

## API baseline
GET/POST /api/v1/carriers; GET/PATCH /api/v1/carriers/:id;
GET/POST /api/v1/contacts; GET/POST /api/v1/appointments;
GET/POST /api/v1/agency-codes; GET/POST /api/v1/appetite-profiles;
GET/POST /api/v1/commission-agreements; GET/POST /api/v1/commission-schedules;
GET/POST /api/v1/documents; POST /api/v1/change-requests;
POST /api/v1/change-requests/:id/approve; GET /api/v1/search;
POST /api/v1/imports/preview; POST /api/v1/imports/commit;
GET /api/v1/audit-events (admin/compliance only).
All endpoints versioned, validated, paginated where applicable, permission-checked, and audited on writes. Never expose financial fields through unrestricted carrier responses.
