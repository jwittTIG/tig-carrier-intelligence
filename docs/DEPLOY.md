# Putting TIG Carrier Intelligence on the web (Render)

Decisions: D8a (Render), D11a (files on a Render disk), D24 (no virus scanner yet), D9 (Microsoft 365 sign-in through Clerk). The Render setup is in `render.yaml`.

**What runs on Render:** one web service (the app, with a private 1 GB disk at `/var/data` for uploaded files) and one PostgreSQL 17 database (a paid plan for daily backups and point-in-time restore). Address: **carriers.tigknoxville.com**.

**Secrets:** you type the Clerk keys and the Anthropic key into the Render dashboard yourself. They never go in a file, a commit or a chat. Render generates the download-link signing secret on its own.

**Who does what:** steps marked **Josh** need your accounts, card or DNS. Claude does the steps marked **Claude**.

---

## 1. GitHub (Josh, then Claude)
1. **Josh:** create a **private** repository on GitHub, e.g. `tig-carrier-intelligence`, empty (no README). Send Claude its address.
2. **Claude:** adds it as the app's GitHub address and pushes `main`.

## 2. Test Microsoft 365 sign-in locally first (Josh, then Claude)
Sign-in through Clerk has never run yet: this PC uses the development sign-in picker. Test it here before the web.
1. **Josh:** at dashboard.clerk.com, create an application "TIG Carrier Intelligence" with **Microsoft** as the only sign-in option. Copy its **development** Publishable key and Secret key into `.env.local` yourself (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`), and set `AUTH_DRIVER="clerk"`.
2. **Claude:** restarts the dev server and checks sign-in with you: your Microsoft account signs in as your existing Admin user, and an account outside tigknoxville.com is refused.

## 3. Create the Render services (Josh)
1. Create an account at render.com and add TIG's card (in Render; Claude never handles payment details).
2. **New → Blueprint**, connect GitHub, pick the repository. Render reads `render.yaml` and shows the **tig-carrier-intelligence** web service, its disk and the **tci-db** database. Check the plans and prices it shows before you confirm.
3. When it asks for the secret values:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`: the Clerk **development** keys for now (step 7 swaps in production keys).
   - `ANTHROPIC_API_KEY`: the Anthropic key. Check Anthropic's data-retention terms first (D12, still open).
4. Apply. The first deploy builds the app and creates the database tables (migrations run on every start). The site is at `https://tig-carrier-intelligence.onrender.com` (or similar). Health check: `/api/health` shows `{"status":"ok"}`.

The database starts **empty** and nobody can sign in yet. Step 4 copies your data, including your user.

## 4. Copy the data (Josh runs the commands; Claude can watch)
Copies every row from this PC's database into Render's, in one transaction. It only reads this PC's database. It refuses unless Render's database has the same migrations and is completely empty, so it can't overwrite anything.
1. In Render, open **tci-db → Networking** and add **your current IP address** to the allowed list (temporarily).
2. Copy the **External Database URL** from tci-db's Info page.
3. In PowerShell, in `C:\dev\tig-carrier-intelligence` (this sets the address for this window only and doesn't save it anywhere):
   ```powershell
   $env:MOVE_TARGET_DATABASE_URL = '<paste the External Database URL>'
   npm.cmd run data:move
   ```
   That's a dry run. It lists the tables and row counts and copies nothing. If it looks right:
   ```powershell
   npm.cmd run data:move -- --commit
   Remove-Item Env:MOVE_TARGET_DATABASE_URL
   ```
   It ends with `Done: N rows copied and counts match in all 52 tables.` If anything fails, nothing is kept, and the database stays empty.
4. In Render, **remove your IP** from the allowed list again.

Rehearsed on 2026-11-18 into a throwaway local database: 7,022 rows in 52 tables copied, every table identical row for row, a second run refused, and a failed run left nothing behind.

## 5. Copy the uploaded files (Josh)
The guides, documents and logos (about 16 MB) live in `.data\storage`. They go to the disk at `/var/data/files`.
1. In Render: **Account settings → SSH public keys**, add your SSH public key (create one with `ssh-keygen -t ed25519` if you don't have one). Then open the web service's **Connect → SSH** to see its SSH address (like `srv-xxxx@ssh.ohio.render.com`).
2. In PowerShell, in `C:\dev\tig-carrier-intelligence`:
   ```powershell
   ssh <ssh address> mkdir -p /var/data/files
   scp -s -r .data/storage/* <ssh address>:/var/data/files/
   ```
3. Check: open a carrier with a logo and a guide on the web; the logo shows and the guide opens.

## 6. Check it works (Josh and Claude)
- Sign in with Microsoft. You land on the Dashboard as Admin.
- Carriers, contacts and codes are all there. A guide opens; Ask the guides answers a question (about 1¢).
- Upload a small PDF. It's saved, and its record says scanner "none (D24)".

## 7. Your own address and production sign-in (Josh; Claude gives exact values)
1. **Render:** web service → Settings → **Custom Domains** → add `carriers.tigknoxville.com`. Render shows a CNAME record.
2. **Clerk:** create the **production** instance of the application with domain `carriers.tigknoxville.com`. Clerk shows several DNS records (CNAMEs).
3. **DNS:** whoever manages tigknoxville.com's DNS adds Render's CNAME and Clerk's records. Wait until Render and Clerk both show them as verified.
4. **Microsoft Entra** (entra.microsoft.com → search "App registrations"; needs a TIG Microsoft 365 admin): register "TIG Carrier Intelligence" with **Any Entra ID tenant + personal Microsoft accounts** (Clerk's Microsoft connection supports only that today; single-tenant is "coming" per Clerk's docs, and SAML is the alternative) and the Web redirect URI Clerk shows (`https://clerk.tigknoxville.com/v1/oauth_callback`). Put the client ID and a client secret (24 months, the maximum: **renew before it expires or sign-in stops**) into Clerk's Microsoft settings, not anywhere else. Outsiders are still kept out by the app: only tigknoxville.com addresses with a user in the app get in.
   Done 2026-11-18: Clerk production on **tigknoxville.com** (records clerk, accounts, clkmail, clk._domainkey, clk2._domainkey in GoDaddy), carriers CNAME to Render, Entra app registered, secret expires about 2028-11.
5. In Render, replace the two Clerk keys with the **production** keys; the service redeploys.
   **Before signing in:** Claude clears each user's link to the old (development) Clerk sign-in in Render's database, so the first production sign-in links again by email (`linkIdentityOnFirstSignIn`). Otherwise existing users would be refused ("no access"), because Clerk production gives everyone new IDs.
6. Sign in at https://carriers.tigknoxville.com.

## 8. Before relying on it: test a restore (Josh, with Claude)
Render backs the database up daily and can restore to a point in time (paid plan). Once, before go-live: restore to a **new** database in Render, check it has the data, then delete the restored copy. The disk has daily snapshots too (web service → Disks).

---

## Later, every update
Claude pushes to `main` → Render builds, runs migrations and restarts (a short pause, because of the disk). Data entered on the web stays there. This PC's database is no longer the real one after step 4.

## Not on the web yet
- **Email intake** (Inbox): off until docs/EMAIL_SETUP.md is done (`MAIL_INTAKE_DRIVER`, the `MS_GRAPH_*` values and `CRON_SECRET` in Render).
- **Virus scanning:** none (D24). Uploads are staff-only, and every file's type is checked by its content.
