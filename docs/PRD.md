# TIG Carrier Intelligence — Product Requirements Document
Version 2.0 | 2026-11-04 | Status: Development blueprint (proposed; not yet approved)

## Vision
One source of truth for TIG's P&C market relationships, appetite, underwriting contacts, agency appointments/codes, commission schedules, carrier documents, and market intelligence.

## Scope
IN: Commercial property, general liability, BOP, workers compensation, commercial auto, umbrella/excess, professional liability/E&O, D&O, EPLI, cyber, environmental, inland marine, builders risk, crime, personal home/auto/umbrella, flood, specialty/E&S, habitational, surety/bonds, and other P&C products. Support admitted/nonadmitted insurers, writing companies, groups, MGAs/MGUs, wholesalers, program administrators, and general agencies.
OUT: Life, health, employee benefits, disability, long-term care, medical networks/plans, enrollment, policy administration, claims adjudication, carrier rating/quoting, premium billing, and automated binding.

## Personas and permissions
- Producer: search carriers/appetite, view authorized contacts and agency codes, submit corrections; commissions only if separately authorized.
- Account manager/CSR: search, portal links, submission requirements, suggest updates.
- Marketing specialist: edit assigned contacts/appetite, manage verification and documents.
- Carrier relationship manager: manage assigned carrier relationships and appointments.
- Finance: manage/view commission agreements, schedules, reconciliation exports.
- Leadership: cross-unit reporting, restricted agreements by explicit grant.
- Compliance: audit, appointments, licensing evidence, approval review.
- Admin: users, roles, taxonomy, import mapping, system configuration; access to financial data requires explicit permission.
- Auditor: read-only access scoped to authorized entities.
Permissions apply by agency legal entity, business unit, line of business, and record classification. Default deny.

## Screens and user actions
1. Dashboard: assigned carriers, stale verification tasks, pending approvals, recently changed appetite, appointments approaching expiry, quick search.
2. Carrier Directory: search/filter organization type, group, writing company, line, state, active status, assigned owner, verification freshness; create/archive.
3. Carrier Profile: Overview, Writing Companies & Channels, Products, Appetite, Contacts, Appointments/Codes, Commissions (permission gated), Documents, Activity, Change History.
4. Market Finder: line, product, state, industry/NAICS, construction/occupancy/TIV, vehicles, payroll, exposures, limits; results show preferred/accepted/referral/prohibited/unknown, rule provenance, verification freshness, appointment availability. MVP supports structured filtering and manual eligibility; automated rules matching is P1.
5. Underwriter Directory: search contact, organization, specialty, territory, authority, backup, verification date; CRUD and relationship notes.
6. Appointments & Codes: agency entity, market channel, writing company, state, product, code type/value, dates/status, portal link, supporting agreement; CRUD and expiry warnings.
7. Commission Center: restricted agreements and schedules, new vs renewal, flat/rate/tier, basis, effective period, source and approvals; CRUD and exports.
8. Documents & Bulletins: upload/version, classify, link to records, source page/section, access classification; review metadata. AI extraction is P2.
9. Data Quality / Approvals: pending corrections, proposed vs current, source, approve/reject, stale record queue, duplicate candidates.
10. Administration: identity/role mapping, agency entities, business units, line taxonomy, import jobs, audit events, integration health.
11. Analytics (P1): premium, submissions, quotes, binds, hit ratio, market responsiveness, carrier concentration and appetite gaps.
12. Submission Workspace (P1): risk, markets approached, checklist, quotes, declinations, placement outcome.

## P0 functional requirements
P0-01 organizations/groups/writing companies/intermediaries with relationships.
P0-02 carrier products and distribution channels, with P&C-only taxonomy.
P0-03 contact directory and multiple assignments by territory/product.
P0-04 agency entities, appointments, agency codes and portal URLs.
P0-05 appetite profiles and searchable rules with effective dates, source and review state.
P0-06 commission agreements/schedules, new/renewal, effective dates, restricted visibility.
P0-07 private documents, versioning and links to business records.
P0-08 global search, filters and carrier profile.
P0-09 human approval workflow for material updates and immutable audit history.
P0-10 CSV import with preview, validation, duplicate detection and error report.
P0-11 SSO/OIDC-capable authentication, role + entity scoped authorization.
P0-12 verification owner/date and freshness indicators.

## P1
Risk intake and deterministic rule matching; market comparison; submission checklists and history; alerts; AMS integration via adapter; production analytics; commission reconciliation.

## P2
AI bulletin extraction with human approval, conversational search with citations, historical market recommendation, contingency modeling, carrier feeds.

## Workflows
A. Carrier onboarding: create organization -> associate writing companies/intermediaries -> products/channels -> appointments/codes -> contacts -> commission schedules -> appetite/source docs -> review -> activate.
B. Appetite change: upload source -> propose effective-dated change -> compare -> authorized approval -> version old record -> notify impacted users (P1).
C. Search: filter risk and jurisdiction -> show matched markets and known restrictions -> display verification/source and underwriter -> user chooses market. Never auto-bind.
D. Commission: finance creates schedule -> attaches agreement -> approver confirms -> authorized users view effective rate. Reconciliation P1.
E. Data verification: owner receives stale task -> confirms/updates -> records verified_at/source -> next review scheduled.
F. CSV import: upload -> map columns -> preview -> validate -> deduplicate -> commit transaction -> export errors and audit log.

## Business rules
- One insurer can have multiple products and market access channels.
- One agency entity can have multiple codes per market/line/state; historical codes retained.
- Overlapping approved commission schedules with same exact scope must be blocked or escalated.
- Conflicting appetite rules must be flagged; unknown is distinct from eligible.
- Dates and states govern appointments and market availability.
- Carrier appetite never constitutes binding authority.
- Data provenance, last verified, owner and effective dates are mandatory for approved material records.

## Nonfunctional targets (to validate)
99.9% availability after stabilization; p95 search <2 seconds on target data size; MFA via IdP; TLS and encryption at rest; immutable audit logs; private document storage; WCAG 2.2 AA target; daily backups and tested restore; proposed RPO 1 hour/RTO 4 hours. Compliance/retention rules to be confirmed with TIG.

## Success measures (pilot targets)
95% active market profiles verified within review window; 100% approved commission schedules source-linked; <1% duplicate organizations; <60-second common market lookup; zero critical authorization findings; 80% pilot weekly adoption.

## Open decisions
TIG's AMS and available API; identity provider; hosting/cloud; agency legal entities; approved carrier taxonomy; commission visibility policy; review cadence; retention; number of users/records; production data migration owners; carrier contract restrictions.
