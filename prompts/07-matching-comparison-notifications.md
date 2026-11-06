# Milestone 7: risk matching, market comparison, notifications (P1)

Status: built 2026-11-06, waiting for Josh's review. Josh chose these three P1 items ("P1 - no need for submission workflow, connection to agency management system, production dashboard or commission reconciliation", then "Go ahead and the next milestone"). Decisions D21–D23 are the defaults used; Josh can change them at review.

Prerequisite: Milestone 6 accepted (2026-11-06).

## Build
- **Risk matching (D21)** in the Market Finder:
  - When a product (or line) is chosen, show an input for each risk attribute defined for it (revenue, TIV, payroll, years in business…).
  - Attribute rules are evaluated deterministically against what was entered. Numbers, money and dates compare as values; text and lists compare case-insensitively.
  - A rule applies when its states, classes, dates and (if it has one) attribute condition all match. The outcome is the first applying rule by priority, then specificity. An attribute condition counts as more specific than a class or state.
  - **Missing data is never eligible.** If a rule whose attribute wasn't entered would rank ahead of the chosen rule, the result goes in a **Needs information** group that says which values are missing and what the outcome would be without them.
  - Rules that can't be evaluated (e.g. "less than" on text) are treated the same as missing data, with the reason shown.
  - The risk is **not saved** (no client data stored). Values live only in the form and the page address.
- **Market comparison (D22):** tick up to 4 results and compare them side by side for the same risk:
  - outcome and why (each rule, met / not met / needs information);
  - stated limits vs. the limit wanted, and underwriting requirements;
  - agency codes in use (appointment status removed 2026-11-06, N19);
  - approved commission rate in effect today (new and renewal) for that channel and product, or "Rate not recorded";
  - appetite version, sources, next review, and underwriter contacts;
  - the search disclaimer.
- **Notifications (D23), in the app only** (no email is sent):
  - Staff **follow** carriers (writing companies or intermediaries) from the carrier page.
  - Events:
    - your submission was approved or rejected (to the submitter);
    - something was submitted for approval on a carrier you follow;
    - appetite or a commission was approved on a carrier you follow;
    - an inbox email was filed under a carrier you follow;
    - daily reminders for appetite reviews that are due (followers and the profile owner). Appointment-expiry reminders were removed 2026-11-06 (N19).
  - The person who made the change isn't notified about their own action.
  - A bell with an unread count; a `/notifications` page with mark read / mark all read.
  - Users only ever see their own notifications.
  - Daily reminders run from `/api/cron/reminders` (`CRON_SECRET`). Admins also get a "Check reminders now" button. A reminder is sent once per record and date.

## Definition of done
Tests cover:
- each operator and data type; a missing value is never eligible; a failing condition doesn't apply;
- a "needs information" result names the missing attribute;
- comparison shows commission only with `commission.read`, and keeps the disclaimer;
- notifications are created for each event, not for the actor, and once per reminder;
- a user can't read or mark someone else's notification;
- cron needs the secret.

Plus an end-to-end test: enter a risk, compare two markets, follow a carrier and see a notification.

## Out of scope
- Saved risks and submissions (Josh: no submission workflow).
- Email or Teams delivery of notifications.
- AMS integration, production analytics, commission reconciliation.
