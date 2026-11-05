# Milestone 6 (proposed): email intake for carrier updates

Status: PROPOSED (DECISIONS D20). Requested by Josh 2026-11-05. Not started.

Prerequisite: Milestone 5 reviewed; D20 confirmed (receiving method, allowed senders, timing). For the Microsoft 365 option, TIG's Microsoft admin creates the shared mailbox and an Entra app registration with mail-read permission limited to that mailbox (ApplicationAccessPolicy).

## Build
- **Receiving:**
  - Option A (proposed): poll the shared mailbox with Microsoft Graph on a schedule, using a delta query so each message is read once.
  - Option B: an inbound webhook from a mail provider, with a signature check.
  - Either way, a labeled dev adapter that reads `.eml` files from a local folder and refuses production.
- **Inbox items** (new table, append-only original):
  - Message-ID, from, to, subject, received time, plain-text body (HTML sanitized to text), attachment list;
  - the original `.eml` stored as a document;
  - each attachment stored as a document (content checks, scan hook and size limit from M4).
  - Duplicates are found by Message-ID and attachment sha256.
- **Sender rules:**
  - Forwarded mail from an active TIG user is accepted and attributed to that user.
  - Anything else is held as "unknown sender" for an admin to accept or discard.
  - SPF/DKIM results are recorded.
- **Triage screen** (`/inbox`):
  - list with filters: new / triaged / dismissed, carrier, date;
  - detail view: body, attachments, "file under carrier", "add as source to…", "start appetite draft from this", "start commission schedule draft from this", dismiss with a reason;
  - every action audited.
- **Carrier tab:** "Updates" lists inbox items filed under the carrier.
- **Data quality:** untriaged items older than N days (setting) appear on the approvals/data-quality page.

## Definition of done
Tests cover:
- duplicate suppression;
- unknown-sender hold;
- attachments go through the same checks as uploads;
- triage actions create sources and drafts, never approved records;
- no access without `document.read`.

Plus an end-to-end test using the dev `.eml` adapter.

## Out of scope
- AI summaries or extraction of bulletins (P2).
- Replying to or sending email.
- Reading staff members' personal mailboxes.
