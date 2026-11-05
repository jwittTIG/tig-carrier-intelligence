# Milestone 4: appetite, commissions, documents, approvals

Status: built 2026-11-05; accepted by Josh 2026-11-05.

Prerequisite: Milestone 3 reviewed; D11, D14 and D15 confirmed.

Contract:
- PRD screen 3 (Appetite, Commissions and Documents tabs) and screens 7–9.
- PRD requirements P0-05, P0-06, P0-07, P0-09 and P0-12.
- ACCEPTANCE_TESTS sections "Appetite", "Commissions" and "Documents and approvals".

## Build
- **Private document storage:**
  - dev adapter and R2 adapter;
  - file type checked by content, plus size limits;
  - sha256 duplicate detection and versions;
  - signed URLs issued only after a permission check;
  - scanning hook (dev stub, labeled).
- **Appetite profile and rule editor:**
  - territories, industries (NAICS, ISO, NCCI and carrier codes) and attribute rules;
  - coverage capabilities and underwriting requirements;
  - effective dates and source links (`record_sources`);
  - a warning when overlapping rules give different outcomes.
- **Commission agreements and schedules:**
  - by transaction type (new, renewal, endorsement);
  - by basis (rate, flat, tiered);
  - by territory and effective period;
  - contingency notes, source document, exports.
- **Change requests:** propose → compare old and new with the source → approve or reject (D14) → keep the prior version → write an audit row. An approved appetite profile requires a source.
- **Data-quality queue:** pending changes, stale records, duplicate candidates.

## Definition of done
Every ACCEPTANCE_TESTS item in these sections passes, or is marked N/A under D1 with the reason.
