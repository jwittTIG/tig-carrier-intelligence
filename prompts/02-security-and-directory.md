# Milestone 2: security and carrier directory

Prerequisite: Milestone 1 reviewed by Josh; D9 (identity provider) confirmed.

Contract:
- PRD screens 2–3: Directory; Profile Overview and Writing Companies & Channels.
- PRD requirements P0-01, P0-02, P0-08 (carrier part) and P0-11.
- ACCEPTANCE_TESTS sections "Access control" and "Carrier model".

## Build
- **Sign-in** with Microsoft 365 work accounts through Clerk (D9), limited to the `tigknoxville.com` domain. No email/password sign-up. First sign-in links `users.identity_subject`; deactivated users are blocked.
- **Authorization:** `AuthContext` + `assertCan(ctx, permission)`, default deny. Services take the context. Route handlers and server actions never import the Prisma client directly (enforced by an ESLint rule).
- **Audit helper:** every write records an `audit_events` row (before/after) in the same transaction, with a correlation id.
- **Carrier directory:**
  - search by name (trigram);
  - filter by type, group, line, state, status, owner and verification freshness;
  - create, edit and soft-archive.
- **Carrier profile** tabs: Overview, Writing Companies & Channels, Activity (notes), Change History. Other tabs stay hidden until built.
- **Organization relationships** (group, MGA, wholesaler and program-admin links) with effective dates.
- **API:** versioned `/api/v1/carriers` endpoints per IMPLEMENTATION_PLAN, validated with Zod and paginated.
- **Admin:** list users, invite, deactivate, assign roles.

## Definition of done
- Unauthenticated requests get 401 on every private route.
- Substituting another record's ID can't reach archived or missing records incorrectly.
- Every write produces an audit row (tested).
- Restriction tests marked N/A under D1 are listed in PROGRESS.
- Playwright covers login and carrier creation.

## Out of scope
Contacts, appointments, appetite, commissions, documents, import.
