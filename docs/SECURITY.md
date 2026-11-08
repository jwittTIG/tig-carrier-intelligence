# Security notes

Status: written 2026-11-05 at the end of Milestone 5. **This is not a security review.** A real review (by someone other than the author) is required before production use (README, "Deployment prerequisites").

## Access
- **Sign-in:** Microsoft 365 through Clerk (D9). Not tested yet: no Clerk keys.
  - Invite-only (D18). The first sign-in links the account by verified email, restricted to `ALLOWED_EMAIL_DOMAINS`.
  - A deactivated user is refused on the next request.
- **Development sign-in** (`AUTH_DRIVER=dev`) refuses to run when `NODE_ENV=production`, and every page shows a banner while it is on.
- **Authorization:**
  - Every service function calls `assertCan` first (default deny), and permissions come from the database.
  - Pages, actions and route handlers can't import the database client (ESLint rule).
  - `tests/integration/route-sweep.test.ts` calls every `/api/v1` route and method without a session and expects 401, so new routes are covered automatically.
- **D1:** everyone at TIG sees everything (STAFF and ADMIN roles). The permission checks still run, so restricting a role later is a data change. Tests with limited TEST roles prove that commission, document, audit and import permissions are enforced.

## Data
- **Documents:**
  - private storage under unique, never-overwritten keys;
  - file type checked by content; size limit;
  - scanning hook (dev stub; a real scanner is needed for production);
  - downloads only through a permission check, then a 5-minute HMAC-signed link (`STORAGE_SIGNING_SECRET`).
  - Restricted documents also need `commission.read` and return 404 otherwise.
- **Portal links** never hold credentials. URLs with a username or password are refused, and text that looks like a password is refused (best effort).
- **Audit log** is append-only, enforced by a database trigger (update, delete and truncate are rejected).
- **CSV exports** neutralize cells that start with `= + - @` so spreadsheets don't run them as formulas.
- **Errors** returned to users never include internal details. Logs record the error name only.

## HTTP
- Headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `frame-ancestors 'none'`, a strict referrer policy, and a permissions policy. The `X-Powered-By` header is turned off.
- Cache Components is off; private pages render per request with no shared cache.
- Server actions use Next.js's built-in origin check.

## Dependencies (npm audit, 2026-11-05)
- Production dependencies: **0 known vulnerabilities**.
- Dev tooling only: 8 moderate findings (`minimatch` under the ESLint/TypeScript toolchain). Not shipped to users. Revisit when the toolchain updates.

## Known gaps before production
1. A security review and penetration test.
2. A real malware scanner and R2 storage (D11).
3. The Clerk + Microsoft sign-in, tested end to end with TIG's tenant.
4. Rate limiting on sign-in and the API (Clerk covers sign-in; API rate limits are not built).
5. A Content-Security-Policy beyond `frame-ancestors` (needs Clerk's script domains once known).
6. Backups, plus a tested restore (`docs/OPERATIONS.md`).

## AI (Milestone 8, Ask the guides)
- **What leaves the app:** the carrier guide PDFs (types Appetite guide and Underwriting guidelines only, never Restricted documents) and the staff member's question go to Anthropic's API (D12). No client data is needed for a question; staff are told not to type client names.
- **Files:** guides are uploaded to Anthropic's Files API once and kept there (ids in `ai_document_files`). Deleting them there is not built yet.
- **Retention and training terms:** to be checked by Josh before real use (D12).
- **Key:** `ANTHROPIC_API_KEY` is read on the server only and never sent to the browser.
- **Prompt injection:** the system prompt treats guide text as reference data, not instructions; answers are shown as text only (no links or HTML from the model).
- **Audit:** every question, the guide versions used, the model, the answer and its quotes are stored (`guide_questions`) with an audit event.
