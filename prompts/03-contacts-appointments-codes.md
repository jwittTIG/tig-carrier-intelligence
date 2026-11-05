# Milestone 3: contacts, appointments, codes

Status: built 2026-11-05; accepted by Josh 2026-11-05.

Prerequisite: Milestone 2 reviewed.

Contract:
- PRD screens 5–6.
- PRD requirements P0-03, P0-04 and P0-12.
- ACCEPTANCE_TESTS sections "Contacts" and "Appointments and codes".

## Build
- **Underwriter directory:**
  - contacts with multiple assignments, each with organization, channel, territory, role, title, authority notes and backup contact;
  - specialties by product and industry;
  - a "who's my rep for X in Y" filter.
- **Verification:** "Confirm still current" records a `verification_events` row and sets the next review date from `app_settings` (D15). Stale records get a badge.
- **Agency appointments** per agency entity and channel, with authorizations by territory and product.
- **Agency codes** with producer assignment, change history and expiry warnings.
- **Portal links:** URL, instructions and a password-manager reference. The form states that credentials are never stored and rejects obvious credential text.
- **Relationship activity notes** on carriers and contacts.

## Definition of done
Each of these has a test:
- Expired appointments never show as active.
- Overlapping active duplicate codes show a clear error.
- Code change history is readable.
