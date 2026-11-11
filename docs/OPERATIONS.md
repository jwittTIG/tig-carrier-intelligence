# Operations

## Environments
- **Local (now):** two `prisma dev` servers (PGlite): `tci` for dev, `tci-test` for tests. They are fine for building, but not reliable enough to depend on (DECISIONS D7a). Data there is disposable.
- **Hosted (proposed, D8):** Vercel for the app, Neon for Postgres (its own project, with `dev` and `test` branches), Cloudflare R2 for files (D11), Clerk for sign-in (D9). Nothing is deployed yet.

## Deploying (once D8, D9 and D11 are set up)
1. Create the Neon project, Clerk app, R2 bucket and Vercel project. Put secrets only in Vercel environment variables:
   - `DATABASE_URL`, with `DATABASE_POOL_MAX` unset or above 1;
   - `AUTH_DRIVER=clerk`, the Clerk keys and `ALLOWED_EMAIL_DOMAINS=tigknoxville.com`;
   - `STORAGE_DRIVER=r2` with its keys, once built;
   - a fresh `STORAGE_SIGNING_SECRET`.
2. Run migrations against the hosted database: `npm run db:migrate`.
3. Seed reference data only: `npm run db:seed` (DEMO records are added only with `SEED_DEMO=1`). This adds the line taxonomy, states, roles and settings. Never load DEMO data in production.
4. Invite the first admin directly in the database (one row in `users` plus a `user_role_scopes` ADMIN row), then invite everyone else from **Users**.
5. Smoke test: `/api/health` returns ok; sign in with Microsoft; open each main screen.

The `dev` sign-in, `dev` storage and the dev malware-scan stub all refuse to run in production, so a mis-set variable fails loudly instead of quietly opening access.

## Backups and restore (to set up before real data)
- **Targets proposed in the PRD:** RPO 1 hour, RTO 4 hours. Neon's point-in-time restore covers the database. R2 needs object versioning or a scheduled copy.
- **Restore drill (required before go-live; record the result in `docs/PROGRESS.md`):**
  1. Branch or restore the Neon database to a point in time.
  2. Point a preview deployment at it.
  3. Check record counts, open a few carriers and documents, and confirm downloads work.
  4. Time it against the 4-hour target.
- The audit log is append-only, so a restore is the only way to "undo" history. That is intentional.

## Routine
- **Daily:** nothing manual. Stale contacts, overdue appetite reviews and expiring appointments show on the dashboard and on **Approvals**.
- **Settings** are rows in `app_settings`:
  - review cadence days;
  - appointment warning days;
  - maximum upload size;
  - the Market Finder disclaimer text.

  A settings screen isn't built yet; change them in the database and the change is audited only if done through the app. A settings screen is a follow-up.
- **Tests:** `npm run check` (lint, types, unit and integration tests, build) and `npm run test:e2e` (browser tests against the dev server).

## Scheduled jobs
Both need `CRON_SECRET` (32+ characters) and send `Authorization: Bearer <CRON_SECRET>`. Neither has run on a schedule yet (no hosting).
- `GET /api/cron/mail-intake`: every 15 minutes (M6).
- `GET /api/cron/reminders`: once a day, early morning (M7). It sends in-app reminders for appointments ending within `appointment.expiry_warning_days` and for appetite reviews due. It is safe to run more than once: each record and date is sent once.

## Troubleshooting (local)
- **Pages reload over and over (sign-in won't click, "Compiled in 1ms" repeating):** a stale Next build cache, usually after a source file was deleted. Stop the dev server, delete `.next` (or `.next-e2e` for the test server), and start it again.
- **Builds while the dev server runs:** use `NEXT_DIST_DIR=.next-build npm run build` so the build doesn't write into the dev server's `.next`.
- **"connect ECONNREFUSED" on port 51214/51218:** the local databases stopped (e.g. after a restart). Run `npm run db:start`.
