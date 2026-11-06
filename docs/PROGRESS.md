# Progress

## Current state (2026-11-06)
**Milestone 7 (P1: risk matching, market comparison, notifications) is built and waiting for Josh's review.** Josh picked these three P1 items and said "Go ahead and the next milestone" (2026-11-06); he excluded the submission workflow, AMS connection, production dashboard and commission reconciliation. D21–D23 record the defaults used (still PROPOSED). M0–M6 are accepted (M6: "Proceed", 2026-11-06). M6 detail: built on the dev mailbox. The real Microsoft 365 mailbox isn't set up yet (docs/EMAIL_SETUP.md), so the Graph reader is untested. Josh moved from M5 to M6 ("Yes, start M6", 2026-11-05). Earlier status: Josh accepted M4 ("Proceed with the next step", 2026-11-05). D14 for appointments/codes was not answered, so they keep saving directly. Josh asked for email intake of carrier bulletins and guideline updates: proposed as Milestone 6 (DECISIONS D20, `prompts/06-email-intake.md`). D7a (real Postgres) is still open. The MVP is **not production-ready**: see `docs/SECURITY.md` "Known gaps" and `docs/OPERATIONS.md`.

## Milestone 7: risk matching, market comparison, notifications (done; waiting for Josh's review)
- **Menu tidy-up (2026-11-06, Josh):**
  - New **Setup** page (`/setup`) holds Industry codes and search words, which moved to `/setup/industries`.
  - The **Codes** menu item and page were removed. A code is found on the carrier page (Appointments & codes tab) or with the search box. The CSV export stays in the API only.
  - The contacts browser test now checks the code on the carrier page.
- **New look with a color picker (added 2026-11-06; DECISIONS N18):**
  - Colored sidebar (initials avatar, name, role, search, icon menu with the current page highlighted, notification count, sign out) on a light gray page with rounded white cards.
  - Dashboard tiles have icons and the real counts. On phones the menu folds into a **Menu** button.
  - **Color** at the bottom of the sidebar: 8 presets or a custom color, saved per browser (cookie). Shades are derived so text stays readable.
  - Also fixed: secondary gray text was a shade too light on the gray page, and red buttons failed contrast in dark mode.
  - Tested: unit tests for the palette (contrast for presets and extreme colors such as yellow, white and black). The accessibility sweep now runs 4 times: light, dark, a yellow accent and a very dark accent. It passes on all 15 screens. All 12 browser tests pass. Checked by eye at desktop and phone width, in teal and purple.
- **Industry search by words (added 2026-11-06 at Josh's request; DECISIONS N16):**
  - The Market Finder's Industry field takes words or a code: "roofing", "roofer", "electrician", "restaurant", 238160 or NAICS 238160.
  - Words are matched to the official 2022 NAICS titles (2,125 codes from the Census Bureau, loaded by the seed). Exactly one six-digit match is used directly, e.g. "roofing contractors" → 238160. Otherwise a **Which industry?** list appears: "roofer" offers Roofing Contractors, roofing material wholesalers, and broader groups.
  - The chosen code and its title are shown above the results.
  - API: `GET /api/v1/industries?q=roofing`. Migration `20261106123839_industry_codes` (needs Josh's review).
  - Tested: unit tests for word matching, Market Finder integration tests (one match, several matches, no match), and the appetite browser test now searches "roofer" and picks Roofing Contractors. Checked by eye in the browser.
- **Staff search words for industry codes (added 2026-11-06; DECISIONS N17):**
  - **Setup → Industry codes and search words** (`/setup/industries`; moved from its own menu item at Josh's request): search NAICS by words or code, then open a code, e.g. `/setup/industries/NAICS/238220`. The code page shows the title, its parent groups, the industries under it, and its search words, with Add and Remove.
  - Example: add "hvac" to 238220 (Plumbing, Heating, and Air-Conditioning Contractors). Searching "hvac" in the Market Finder then goes straight to it.
  - Words are stored lowercase, 2–60 characters (DB CHECK); duplicates on one code are refused; every add and remove is audited. Needs `appetite.write`.
  - The Market Finder links to the Industries page when nothing matches and below the "Which industry?" list, and shows each code's search words there.
  - API: `POST /api/v1/industries/NAICS/:code/keywords`, `DELETE /api/v1/industry-keywords/:id`. Migration `20261106125842_industry_keywords` (needs Josh's review).
  - None are seeded: TIG adds its own.
  - Tested: `industries.test.ts` (reference data, add/find/remove, duplicates, bad input, permissions, DB check) and the browser test `industries.spec.ts` (add a word, find it in the Market Finder, remove it). Both industry pages are in the accessibility sweep.
  - Not done: word search when entering industries on appetite rules (still codes there); SIC titles.
Prompt: `prompts/07-matching-comparison-notifications.md`. Decisions D21–D23 (PROPOSED defaults).
- **Risk matching (D21):**
  - The Market Finder shows an input for each risk attribute defined for the product or line (e.g. annual revenue). Inputs are `a_<key>` fields and are not saved.
  - Attribute rules are evaluated exactly: decimals compare as strings (no floating point); dates, text, lists and yes/no are supported. Logic: `src/lib/matching.ts`.
  - An attribute rule counts as more specific than a class or state rule.
  - A missing or non-comparable value that could change the outcome puts the market in a new **Needs information** group. It names the missing detail and what the outcome is otherwise. Missing data is never eligible.
  - Invalid input (e.g. "a lot" for revenue) is rejected with the field named.
- **Market comparison (D22):** tick 2–4 results, then **Compare selected** opens `/markets/compare`. It shows, side by side for the same risk:
  - outcome and why, and each condition (met / not met / not entered);
  - limits and underwriting requirements;
  - appointment and active agency codes;
  - approved commission in effect for new and renewal ("Rate not recorded" otherwise; hidden without `commission.read`; drafts never shown);
  - the appetite record, contacts and the disclaimer.
  - API: `GET /api/v1/markets/compare`.
- **Notifications (D23), in the app only:**
  - **Follow / Unfollow** on carrier pages (audited).
  - Events: submissions for approval (to followers), decisions (to the submitter, with the reason), approvals (to followers), inbox emails filed under a carrier (to followers, first filing only), and daily reminders for appointments ending within the warning window and appetite reviews due (to followers and the profile owner).
  - Never sent to the person who acted, or to inactive users. Reminders are sent once per record and date (unique dedupe key).
  - A **Notifications** link with an unread count; `/notifications` with All/Unread and Mark read / Mark all read. Admins get **Check reminders now**.
  - Each user sees only their own; links must be app-relative (DB CHECK).
  - API: `GET /api/v1/notifications`, `POST /api/v1/notifications/:id/read`, `PUT|DELETE /api/v1/carriers/:id/follow`. Cron: `GET /api/cron/reminders` with `CRON_SECRET` (daily).
- **Schema** (migration `20261106111944_notifications`, needs Josh's review): tables `carrier_follows` and `notifications`, enum `NotificationType`. No change to existing tables.
- **Tested (ran and saw pass, 2026-11-06):**
  - `npm test`: 221 tests in 24 files, including new `tests/unit/matching.test.ts`, `tests/integration/compare.test.ts` and `tests/integration/notifications.test.ts`. `market.test.ts` was updated: a missing revenue value is now "needs information".
  - `npm run test:e2e`: 8 Playwright tests, including new `m7.spec.ts` (compare two markets with an axe check; follow Summit, file an email as DEMO Admin, see the notification as DEMO Producer and mark it read). Inbox and Notifications were added to the accessibility sweep.
  - The comparison page was checked by eye in the browser.
- **Not tested / limits:**
  - The browser test doesn't enter a risk attribute: the DEMO seed has none defined. Attribute matching is covered by the unit and integration tests.
  - The reminders cron has never run on a schedule (no hosting yet).
  - Contacts going stale don't send reminders yet; they still show on the dashboard.
- **Note for the dev server:** after a schema change, restart `npm run dev`. The running server keeps the old database client, and every page fails with "Cannot read properties of undefined".

## Milestone 6: email intake (done on the dev mailbox; Microsoft 365 not tested)
- **Mailbox:** Microsoft 365 shared mailbox (D20 confirmed). `docs/EMAIL_SETUP.md` covers creating it, accepting internal mail only, the Entra app, and Exchange "RBAC for Applications" that limits the app to that one mailbox, read-only.
- **Readers:**
  - `dev`: reads `.eml` files from `.data/inbox`; refuses production.
  - `graph`: Microsoft Graph delta query, with page links saved so large backlogs resume. Written, but **never run against Microsoft**; its paging logic is tested with mocked responses.
- **Intake** ("Check mailbox now" for admins, `POST /api/v1/inbox/run`, or `GET /api/cron/mail-intake` with `CRON_SECRET` for scheduling):
  - Each email is taken in once (Message-ID, or content hash).
  - The original `.eml` is kept as a document (new type Email). The body is stored and shown as plain text only.
  - Sender rule: forwarded by an active TIG user → accepted. Anyone else → held, attachments not opened until an admin accepts it.
  - Attachments go through the upload checks (type by content, size, scan stub). Identical files are reused, and small inline images (logos) are skipped.
  - Each refused file is recorded with its reason. One bad email doesn't stop a run; the last run and any error are shown.
- **Inbox** (`/inbox`, `/inbox/[id]`): new / done / dismissed / held, with search.
  - Detail: sender, original sender (read from the forwarded header), attachments, plain-text body, and carrier suggestions (contacts or websites matching the original sender's domain).
  - Actions: file under carrier (the email and files show on the carrier's Documents and new **Updates** tab); start an appetite draft from it (or add it to the open draft), with the attachment as the source; cite it on a record; dismiss with a reason; admins accept or discard held mail.
  - Nothing is ever approved from the inbox (D14 still applies).
- **Elsewhere:** dashboard tile "Inbox emails to handle"; Approvals data quality shows emails waiting longer than `inbox.stale_days` (seeded 7).
- **Permissions:** `inbox.read` and `inbox.triage` (all staff); `inbox.manage` (admins: check now, held mail).
- **New non-login user** "System (mail intake)" records who uploaded intake files (DECISIONS N14).
- **Root cause of Josh's sign-in reload loop found and fixed:** Vitest wrote its caches inside the project (`node_modules/.vitest-cache`). A running `next dev` saw the writes and kept rebuilding and reloading open pages. Test caches and test file storage now live in the system temp folder; a full test run with the dev server up no longer disturbs it.

### M6 tested (ran and saw pass)
- `npm run check`: **183 tests in 21 files** pass. The 13 inbox tests cover:
  - intake from staff: original kept, attachment stored as a typed document, audit row, forwarded sender detected;
  - duplicates by Message-ID and by content; identical attachments reused;
  - refused attachments: .exe, renamed file, EICAR, inline logo;
  - held senders: accept (attachments then stored) and discard; staff can't decide them; held mail can't be triaged;
  - broken mailbox reported;
  - file under carrier (shows on the carrier's documents); carrier suggestion from a contact's domain; appetite draft created with the attachment as source, and reused;
  - cite as source; refusing another email's file; dismiss needs a reason; permissions;
  - Graph paging with mocked Microsoft responses (sign-in, delta pages, removed items, MIME download, delta link, sign-in failure);
  - cron secret; database checks.
- `npm run test:e2e`: **6 Playwright tests pass**. The new one: drop an `.eml` in the dev mailbox → Check mailbox now → open it → file under DEMO Summit Mutual → start an appetite draft that shows the bulletin as its source.
- The dev server log stayed quiet during a full test run (the reload-loop fix).

### M6 not done or not tested
- **The real mailbox:** Graph reading needs the mailbox, the app registration and the three values from docs/EMAIL_SETUP.md. The Microsoft side has never been exercised.
- **Scheduled checks:** need hosting (D8) and a CRON_SECRET; for now an admin presses "Check mailbox now".
- **AI summaries or extraction of bulletins** remain P2.

## Milestone 5: search, import, hardening (done)
- **Market Finder** (`/markets`, `GET /api/v1/markets`):
  - Filter by line or product, state, industry code (NAICS hierarchy: a 2381 rule covers 238160) and the limit wanted.
  - Uses only APPROVED appetite in effect today. Results are grouped Preferred / Accepted / Referral / Prohibited / Unknown.
  - Each result shows the matched rules and why, conditions to check by hand (e.g. revenue ≤ $5M), the limit compared with the stated maximum ("not stated" is never "no limit"), appointment status, appetite freshness, a conflict flag, source count and contacts for that state.
  - Shows the admin-editable disclaimer. Automatic matching against risk details is P1, per the PRD.
- **Global search** (header box, `/search`, `GET /api/v1/search`): carriers (name or exact identifier), contacts, agency codes, documents. Restricted documents are hidden without `commission.read`.
- **Dashboard** (`/dashboard`, the new home page), all real queries:
  - waiting for your review, your submissions, appetite overdue, stale contacts;
  - carriers you own, your overdue profiles, appointments ending soon, appetite approved in the last 30 days.
- **Audit log viewer** (`/admin/audit`, `GET /api/v1/audit-events`): filter by record type, action, person and dates.
- **CSV import** (`/imports`, `POST /api/v1/imports/preview`, `POST /api/v1/imports/commit`, `GET /api/v1/imports/:id/errors`):
  - Carriers and contacts. Upload → columns matched automatically from header names (editable) → row-by-row preview: create / already exists / possible duplicate / error, with reasons.
  - Commit runs in one transaction: all rows or none. Every record gets an IMPORT source (file + row) and an audit row.
  - Downloadable error report. Existing records are never overwritten; possible duplicates are only created by opt-in.
  - XLSX and appetite/codes/commission imports wait for D16 and the sample sheets.
- **Hardening:**
  - a route sweep proves every `/api/v1` route and method needs a session;
  - axe accessibility scan of 11 main screens; it found links told apart by color only, now underlined, plus visible focus outlines;
  - performance test; Market Finder 2.3× faster after moving rule filtering into the database;
  - `docs/SECURITY.md`, `docs/OPERATIONS.md`, `docs/UAT.md`, `docs/ACCEPTANCE_STATUS.md`.
- **Test reliability:** each test file now closes the app's database pool. The abrupt disconnects were crashing local PGlite as the suite grew. The performance test runs separately (`npm run test:perf`).

### M5 tested (ran and saw pass)
- `npm run check` passes: lint, typecheck, **168 tests in 20 files** (passed twice in a row), build. New tests cover:
  - CSV parsing, quoting, formula neutralization, name normalization and similarity;
  - Market Finder grouping, NAICS prefixes, class rules outranking general rules, drafts ignored, unknown for no profile or no stated rule, limit OK / below / not stated, appointed, stale, conflicts, conditions, validation;
  - carrier import end to end (create, exact and in-file duplicates, errors, possible duplicates, opt-in, sources, audit, error report, no re-commit);
  - contact import with assignment and territory; import validation and permission;
  - global search, including the restricted-document hiding; dashboard; audit viewer permission;
  - route sweep of all 30+ API routes.
- `npm run test:perf` (300 carriers, 2,400 rules, local PGlite): Market Finder **median 837 ms / p95 928 ms**; global search **median 87 ms / p95 96 ms**. Target: p95 under 2 s.
- `npm run test:e2e`: **5 Playwright tests pass**. They now include an appetite lookup in the Market Finder after approval, and the accessibility scan.
- `npm audit --omit=dev`: 0 vulnerabilities in production dependencies.

### M5 not done or not tested
- **Restricted-commission Playwright test:** N/A under D1 (every real role has commission access). Covered by service and API tests with a limited TEST role.
- **Import:** XLSX, appetite/codes/commissions import, and undoing an import batch.
- **Settings screen:** settings (cadences, disclaimer, upload size) are database rows with no admin screen yet.
- **Microsoft sign-in, R2, a real scanner, hosting, backups and a restore drill:** all need accounts or decisions from Josh.

## Milestone 4: appetite, commissions, documents, approvals (done)
- **Documents** (`/documents`, `/documents/[id]`, and a carrier Documents tab):
  - Upload with the file type checked by content (PDF, PNG, JPEG, DOCX, XLSX, CSV/TXT). A renamed file is refused.
  - Size limit from the `document.max_upload_mb` setting (seeded 25).
  - Scanning hook: a dev stub that catches only the EICAR test string and refuses production.
  - Storage under unique object keys that are never overwritten. Versions; duplicate detection by sha256; classification (General / Internal / Restricted).
  - Download: `/api/v1/document-versions/:id/download` checks permission, then redirects to a 5-minute HMAC-signed `/api/v1/files` link.
  - Restricted documents also need `commission.read`, and are hidden (404) without it.
  - Storage driver is the `dev` adapter (refuses production); R2 is not built (no bucket or keys yet, D11).
- **Sources** (`record_sources`): link a document version and page, or a staff note ("call with UW on…"), to any record. Append-only.
- **Appetite** (carrier Appetite tab, `/appetite/[id]`):
  - Versioned profiles per carrier product (and optional channel), one draft at a time.
  - Rules: outcome (preferred / accepted / referral / prohibited / unknown), states, industry codes (`NAICS 238160, ISO_GL 91111`), optional attribute conditions with typed values (=, ≤, between, one of…), dates, rationale. Products get attribute definitions (e.g. annual_revenue, MONEY, USD).
  - Conflict warnings when rules with different outcomes could apply to the same risk.
  - Coverage limits and underwriting requirements per carrier product. Blank limits show as "not stated".
  - Submit requires an owner, an effective date, at least one rule and a source.
  - Approval sets the approver, `verified_at`, and the next review (365 days), and retires the previous approved version, which ends the day before and stays readable.
  - "Start a new version" copies the rules but not the sources (they must be cited again).
  - "Confirm still current" on approved profiles. Draft deletion only when there's no review history.
- **Commissions** (carrier Commissions tab, `/commissions/[id]`; hidden without `commission.read`):
  - Agreements per channel and agency entity, with a reference, the signed agreement document (required to submit), contingency/profit-sharing notes (editable any time, audited) and notes.
  - Schedules: new / renewal / endorsement / other, by state or all states, rate % / flat / tiered (with tiers). Percentages are converted exactly to Decimal fractions.
  - Approved schedules never change. Approving a new rate ends the replaced schedule the day before. An overlap with a later approved schedule is refused with a clear message.
  - Retiring a schedule needs `commission.approve` and a reason. CSV export is formula-safe.
- **Approvals (D14)** (`/approvals` and on each record):
  - Submit → PENDING change request → approve or reject.
  - The submitter can't approve their own. An admin can, with a reason of 10+ characters. A rejection needs a reason. The submitter can withdraw.
  - The queue also shows approved appetite past its review date, the stale-contact count, and possible duplicate carriers (trigram similarity > 0.6).
- **API:**
  - `GET/POST /api/v1/appetite-profiles`;
  - `GET/POST /api/v1/commission-agreements`;
  - `GET (JSON or CSV) / POST /api/v1/commission-schedules`;
  - `GET/POST (multipart) /api/v1/documents`;
  - `GET/POST /api/v1/change-requests`, `POST /api/v1/change-requests/:id/approve` and `/reject`;
  - `GET /api/v1/document-versions/:id/download`, `GET /api/v1/files`.
- **Bug found and fixed:** a settings read inside the approval transaction used the global connection, which deadlocked with a one-connection pool. Settings reads now take the transaction client.

### M4 tested (ran and saw pass)
- `npm test`: **15 files, 130 tests pass**. New tests cover:
  - **Documents:** content-type checks, renamed files, EICAR, size limit, versions, duplicates, carrier filing.
  - **Signed URLs:** 5-minute expiry, a tampered token gives 403, the bytes served match the upload.
  - **Restricted documents:** invisible to a user with only `document.read`.
  - **Sources:** a note or document is required.
  - **Appetite rules:** typed values, industry parsing, conflict detection.
  - **Appetite approval:** submit prerequisites; own approval refused for staff; admin's own approval needs a reason; approval by someone else; edits locked after submit; new version copies rules and needs a new source; approving v2 retires v1 ending 2026-12-31; history kept; reject needs a reason; withdraw is submitter-only; one draft at a time; draft deletion.
  - **Commission math:** exact percentage conversion.
  - **Commission rules:** agreement needs its document; schedules need an approved agreement; contingency notes editable but reference locked; new/renewal rates; supersede ends the old schedule the day before; overlap with a later schedule refused (and left pending); tiers; self-approval refused; retire; CSV.
  - **Permissions and API:** `commission.read` enforced on every commission read, CSV and carrier response; 401 on every new endpoint; multipart upload; 303 to a signed URL; commission CSV 403 without the permission.
- `npm run test:e2e`: **4 Playwright tests pass**. The new one, on a fresh carrier: add a product, upload a guide PDF, draft appetite (TN, NAICS 238160), cite the guide p. 2, submit; the submitter sees "Someone else needs to review it"; DEMO Admin approves from the queue; the profile shows Approved with its next review.
- Browser pane: the carrier Appetite tab shows the approved v1 with its review date.

### M4 not done or not tested
- **D14 for appointments and codes:** they still save directly (audited). The confirmed D14 wording includes them. **Question for Josh.**
- **R2 storage:** not built; the dev adapter only. A real malware scanner is also not built (dev stub).
- **Orphaned files:** if the database write fails after a file is stored, the stored file is left behind. Harmless, but no cleanup job yet.
- **Coverage limits and underwriting requirements** are per carrier product and save directly (audited); they aren't versioned with appetite profiles.
- **Merging duplicate carriers** isn't built; the queue only lists candidates.
- **Market Finder / search over appetite** is Milestone 5.

## Milestone 3: contacts, appointments, codes (done)
- **Contacts** (`/contacts`, `/contacts/[id]`):
  - "Who's my rep" search by carrier, state, line and role, plus name/email and confirmation status. A state search matches that state or nationwide (United States). An assignment with no territory recorded never matches a state search.
  - Contact details, with partial updates that change only the fields given.
  - Assignments: carrier, optional channel (must belong to that carrier), territory, role, title, authority notes, backup contact. Ended assignments are kept, never deleted.
  - Specialties by product and optional industry code.
  - Notes filed under one of the contact's carriers; change history; archive.
- **Verification:** "Confirm still current" requires a note on how it was confirmed. It records a `verification_events` row (who, when, how), sets `verified_at`, and puts the next review at `contact.review_cadence_days` (setting, seeded 365). Badges show Never confirmed / Stale / Confirmed with the next review date. Missing settings show "Setting not configured: …" rather than falling back to a hidden default.
- **Carrier profile** gains two tabs:
  - **Contacts:** current assignments with confirmation badges; past ones listed separately.
  - **Appointments & codes:**
    - portal links (URL, where the login lives, instructions);
    - appointments per agency entity and channel, with status and dates;
    - authorizations by state and product (the product must be written by that carrier);
    - codes with producer, dates, status and edit.
- **Effective status rules:**
  - An ACTIVE appointment or code past its end date shows **Expired**, never Current.
  - A record ending within `appointment.expiry_warning_days` (seeded 60) shows **Expiring soon**.
  - A code is never more current than its appointment.
- **Agency codes:**
  - Overlapping ACTIVE duplicates come back as a clear 409: "Code X is already active for this appointment during those dates…". That covers adding a code and re-opening an ended one.
  - A code's value, type and start date can't be edited; you end it and add a new one, so history stays readable.
  - Code changes appear in the carrier's Change history.
- **Codes screen** (`/codes`; **removed 2026-11-06 at Josh's request**: codes are looked up on the carrier's Appointments & codes tab or with global search; the CSV export is still available at `GET /api/v1/agency-codes?format=csv`): filter by code, carrier, producer and status. CSV download: values are quoted, and cells starting with `= + - @` are prefixed with `'` so spreadsheets don't run them as formulas.
- **Portal links:** URLs must be http(s) and can't contain a username or password. Instructions and the "where the login lives" field reject text that looks like a credential (best effort, e.g. "Password: …", "PIN: …").
- **API:**
  - `GET/POST /api/v1/contacts`;
  - `GET (?organizationId) / POST /api/v1/appointments`;
  - `GET (JSON or ?format=csv) / POST /api/v1/agency-codes`.

### M3 tested (ran and saw pass)
- `npm test`: **12 files, 106 tests pass**. New tests cover:
  - effective-state, freshness, overlap and credential-guard rules (unit tests);
  - one contact with several assignments, audited;
  - the rep search: state, nationwide, unrecorded territory, line;
  - ended assignments drop out of search but stay on the contact;
  - verification: note required, 365-day next review, stale/fresh transitions;
  - assignment validation: channel ownership, self-backup, agency org, notes need an assigned carrier;
  - ID substitution for assignments and specialties;
  - partial contact updates;
  - expired and expiring appointments, with code state following the appointment;
  - several appointments per entity; an active appointment needs a start date; authorization product rules;
  - overlapping-code conflict message, re-issue after ending, and re-opening blocked;
  - code history: audit before/after, also on the carrier;
  - code validation: start date required, deactivated producer refused, ID substitution across appointments;
  - CSV quoting and formula neutralization;
  - portal credential refusals;
  - API 401s on all new endpoints, contacts list, 400 without organizationId, CSV download.
- `npm run test:e2e`: **3 Playwright tests pass**. The new one: create contact → assign to DEMO Summit Mutual in Tennessee → confirm → find via carrier + state search → Codes screen shows DEMO-0001.
- Screens checked by eye in the browser pane: the carrier Appointments & codes and Contacts tabs.

### M3 not done or not tested
- **Agency entities** can't be created in the app yet. Only the seeded `DEMO Agency Entity` exists, pending D17.
- No email or other notification for expiring appointments or stale contacts. That is P1 per the blueprint.
- The appetite/appointment "state" filter on the carrier directory is still deferred; it needs appetite (M4).

## Milestone 2: security and carrier directory (done, Microsoft sign-in not tested)
- **Sign-in** (D9, D18, D19):
  - Clerk with Microsoft 365, invite-only. The first sign-in links the Microsoft account to the invited email.
  - `AUTH_DRIVER=dev` provides a labeled development sign-in that refuses production. The Clerk driver is written but **has never run**: there are no Clerk keys yet.
- **Authorization:**
  - `AuthContext` is built from the database: user_role_scopes → roles → permissions.
  - `assertCan` is default deny and is called by every service function.
  - Pages, actions and route handlers can't import the database client (ESLint rule).
  - INVITED and DEACTIVATED users get no context; deactivation takes effect on the next request.
- **Audit:** `recordAudit` writes before/after JSON and a per-request correlation id in the same transaction as each write.
- **Carrier directory** (`/carriers`):
  - search by display name, legal name or exact identifier;
  - filters: type, line, group, owner, status, include archived;
  - pagination; create; edit; soft archive and restore.
  - State and verification-freshness filters are deferred to M3/M4, and the page says so.
- **Carrier profile** tabs:
  - **Overview:** edit form; identifiers (NAIC, FEIN…) with duplicate protection; relationships with effective dates (only ended, never deleted); group members; archive.
  - **Writing companies & channels:** products written (existing or new P&C product); channels (direct, or through a wholesaler/MGA/program administrator); access status; archive. Intermediaries see "acts as a channel for".
  - **Activity:** notes, calls, meetings.
  - **Change history:** audit rows for the carrier and everything attached to it.
- **API:** `GET/POST /api/v1/carriers`, `GET/PATCH /api/v1/carriers/:id`. Zod validation, pagination, and JSON errors (401/403/404/400/409) with no internal details.
- **Admin users** (`/admin/users`): invite (allowed domains only), change role, deactivate or reactivate. Admins can't deactivate themselves, and the last active admin can't be removed.
- **Security headers:** nosniff, `frame-ancestors 'none'`, referrer and permissions policies. Cache Components is off (`next.config.ts`).

### M2 tested (ran and saw pass)
- `npm run lint`, `npx tsc --noEmit` and `npm run build` pass.
- `npm test`: **9 files, 72 tests pass**. New tests cover:
  - default deny, including a user with no role;
  - the context loader and first-sign-in linking (case-insensitive email; refuses uninvited, deactivated, already-linked and wrong-domain accounts);
  - each carrier write producing exactly one audit row per record (12 writes → 12 rows), with before/after and correlation id;
  - search and filters, archive/restore, stable pagination;
  - ID substitution: agency orgs, unknown and malformed ids are 404; another carrier's products, channels, identifiers and relationships can't be reached through this carrier;
  - validation: AGENCY type, `javascript:` URLs, parent cycles, channel rules, self-relationships, reversed dates, duplicate identifiers;
  - user admin guards;
  - API 401 (no cookie, bad cookie, unknown id, deactivated user), 403 (no role), 400 with issue paths, 201, 404, and no commission/code fields in carrier responses.
- `npm run test:e2e`: **2 Playwright tests pass** (Chromium):
  - unauthenticated redirect and API 401;
  - sign in as DEMO Producer → no Users link → create carrier → audit row in Change history → search → archive.

### M2 not tested
- **Microsoft 365 / Clerk sign-in:** needs a Clerk application and keys from Josh.
- **ACCEPTANCE_TESTS items that assume restricted roles** are not applicable under D1: "Producer without commission.read…", "Admin without explicit finance permission…", "User scoped to agency entity A cannot access entity B…". The permission checks and tables exist; only the seeded roles grant everything.
- **Screens checked by eye:** none. Only Playwright exercised the pages; no screenshots were reviewed.
- **Test reliability:** one run out of five hung while restarting the local test server (D7a).

## Milestone 0: repo and skeleton (done)
- New git repo at `C:\dev\tig-carrier-intelligence` (D3). Blueprint files are in `docs/`; the originals are kept in `docs/blueprint/`.
- Next.js 16.4.3 App Router, TypeScript, Tailwind 4, Prisma 7.10.1, Zod, Vitest 5, Playwright.
- `/api/health`: runs `select 1` and returns `{status, database}`, with 503 when the database is down. It never returns error details.
- `.env.example`, README (setup, migrations, seed, env vars, testing, backup and deployment notes), CLAUDE.md, DECISIONS.md, milestone prompts.
- CI workflow `.github/workflows/ci.yml`. **Not run:** there is no GitHub remote yet (D10).
- Placeholder home page saying it is under construction. It has no links or buttons.

## Milestone 1: data foundation (done)
- Schema `prisma/schema.prisma` covers the blueprint's M1 tables:
  - identity and agency;
  - market structure;
  - appointments and access;
  - people;
  - appetite;
  - finance;
  - documents, provenance, change requests, verification, audit, imports, settings.
- Not created: the P1/P2 tables (DECISIONS N7). Deviations from DATA_MODEL.md are listed in DECISIONS N1–N10.
- Migrations:
  - `20261104235111_init`, generated by Prisma.
  - `20261104235200_constraints`, raw SQL: pg_trgm and btree_gist; date-order CHECKs; approval CHECKs; amount and rate CHECKs; provenance CHECKs; exclusion constraints for overlapping approved commission schedules and overlapping active agency codes; null-normalized unique indexes; trigram indexes; append-only audit triggers.
  - `prisma migrate diff` against the schema is empty (no drift).
- Seed `prisma/seed.ts` is safe to run repeatedly (ran it twice on the dev DB). It adds:
  - 23 P&C lines;
  - US + 50 states + DC;
  - 19 permissions;
  - STAFF/ADMIN roles (D1);
  - settings: review cadence and the disclaimer;
  - DEMO records: 2 users, an agency entity, a group, 2 insurers, a wholesaler, one product written by two companies through two channels, an appointment and code, a portal link, a contact with two territory assignments, a DRAFT appetite profile and rule, a DRAFT commission schedule.

## Tested (ran and saw pass)
- `npm run check` passes: lint, typecheck, `npm test` (4 files, **42 tests**), `npm run build`.
- `npm run db:migrate` + `npm run db:seed` on the dev DB.
- Integration tests run against the local `tci-test` server, which is rebuilt from migrations on every run. They cover:
  - **Commission schedules:** overlapping approved schedules with the same scope are rejected; back-to-back periods, other transaction types and drafts are allowed; a null territory counts as one scope; rates vary by new/renewal, territory and date; bad rates, missing approver and reversed dates are rejected; decimals keep full precision (18,2 and 9,6); an approved agreement needs a source document and approver.
  - **Agency codes:** overlapping active duplicates are rejected; historical and inactive codes are kept; many appointments per entity; reversed dates are rejected.
  - **Appetite:** an approved profile needs owner, approver and effective date; versions are kept and duplicate version numbers rejected; UNKNOWN is the default and distinct from ACCEPTED; attribute rules need an operator and value.
  - **Audit log:** update, delete and truncate are all rejected.
  - **Carrier model:** archiving keeps history; hard delete is refused by the foreign keys; one product has many writing companies and channels; no self-relationships; duplicate identifiers are rejected.
  - **Contacts:** one contact can have several assignments.
  - **Portals:** no credential-like columns; only http(s) URLs.
  - **Provenance:** document and import sources need their link; confidence is only allowed on AI-extracted values.
  - **Scope:** no life/health/benefits tables or seeded lines; seeded orgs, users and codes are all DEMO.
  - **Health route:** returns 200 ok.
- **Mutation check:** with the commission-overlap constraint and the audit trigger removed, the 3 matching tests failed. The migration was then restored, verified identical, and the full suite re-run.

## Not tested (M0/M1)
- **CI workflow:** never run, because there is no remote yet.
- **Real Postgres:** everything was run on PGlite-based `prisma dev` (Postgres 17.5 compiled to WASM). The first run on real Postgres will be CI, Neon or a local install (D7a).
- **ACCEPTANCE_TESTS items for M3–M5:** done; see `docs/ACCEPTANCE_STATUS.md`.

## Remaining
Milestone 7 is waiting for Josh's review. Later phases (do not start without Josh's approval):
- **P1:** done in M7: risk matching, market comparison, notifications. Josh excluded: submission workflow, AMS adapter, production dashboard, commission reconciliation.
- **P2:** AI bulletin extraction, chat search, historical recommendations, contingent commission modeling, carrier feeds.

## Open questions for Josh
1. **Review Milestone 7,** and confirm or change D21–D23 (risks not saved; comparison shows commission; notifications in the app only, no email).
2. **Shared mailbox** (docs/EMAIL_SETUP.md): send the mailbox address, tenant ID and client ID; put the client secret in `.env.local` yourself. Until then the Graph reader is untested.
3. **D14 for appointments and codes:** should they go through approval? They currently save directly.
4. **D7a:** real Postgres for dev/test (Neon connection strings, or OK to install PostgreSQL 17 locally).
5. **Clerk app** for Microsoft sign-in: the two development keys.
6. **R2, hosting (D8), GitHub repo** (send the URL; I'll add the remote and push).
7. **Spreadsheets (D16):** sample sheets with headers and fake rows, so the import matches real columns.
8. **Legal entities (D17):** how many agency legal entities and business units.

## Session log
- 2026-11-04: Phase 0 planning, then the blueprint arrived. Built M0 + M1 per the blueprint. Josh approved resetting the local test DB for test runs this session.
- 2026-11-04/05: Josh confirmed Microsoft 365 sign-in (D9) and approved M1 ("Yes, start M2"). Built M2. Found PGlite instability (D7a); added a pool cap of 1 and a test-server restart.
- 2026-11-06: Josh declined sample inbox emails and accepted M6 ("Proceed"). All planned milestones complete; next phase awaits his choice.
- 2026-11-06: Josh chose P1 risk matching, market comparison and notifications ("Go ahead and the next milestone"). Built M7 with defaults D21–D23.
- 2026-11-06: Josh asked for Market Finder search by words ("roofing", "roofer"). Added NAICS 2022 titles (Census Bureau, downloaded with his OK) and word search (N16).
- 2026-11-06: Josh asked for staff-editable search words ("Yes, add search words"). Added the Industries page and search words (N17).
- 2026-11-06: Josh sent a sample dashboard and asked for a similar look with a pickable main color. Built the sidebar layout and color picker (N18).
- 2026-11-06: Josh asked to move Industries under a Setup page and drop the Codes tab. Done.
