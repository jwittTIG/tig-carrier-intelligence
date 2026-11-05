# Milestone 5: search, import, hardening

Status: built 2026-11-05, awaiting Josh's review. CSV import covers carriers and contacts; appetite, codes and commission imports wait for sample sheets (D16).

Prerequisite: Milestone 4 reviewed; D16 confirmed and Josh's sample spreadsheets received.

Contract:
- PRD screens 1, 4 and 10.
- PRD requirements P0-08 and P0-10.
- ACCEPTANCE_TESTS sections "Imports" and "Quality gates".

## Build
- **Market Finder (MVP):**
  - structured filters: line, product, state, industry code, limits, size attributes;
  - results grouped as preferred / accepted / referral / prohibited / unknown;
  - each result shows its source, verification freshness, appointment availability and contacts;
  - never implies eligibility or binding, and shows the admin-editable disclaimer.
- **Global search** across carriers, contacts and codes.
- **Import:** CSV/XLSX upload → map columns (saved mappings) → preview → validate → flag duplicate candidates → commit in one transaction → error report → audit. Imported values carry `source_kind = IMPORT`.
- **Dashboard:** assigned carriers, stale tasks, pending approvals, recent appetite changes, expiring appointments. Real queries only.
- **Hardening:**
  - audit viewer;
  - accessibility pass (WCAG 2.2 AA target);
  - permission regression tests;
  - security, backup/restore and deployment docs;
  - pilot UAT checklist.

## Definition of done
- All P0 acceptance tests pass, or are N/A under D1.
- p95 search time is under 2 s on a realistic volume of fictional data.
- README is complete.

## Later (do not build without approval)
- **P1:** risk matching, submissions, notifications, AMS adapter, analytics, commission reconciliation.
- **P2:** AI guide extraction with human review (D2, D12), conversational search with citations, contingency modeling.
