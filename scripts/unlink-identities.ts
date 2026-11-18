/**
 * Clears every user's link to a sign-in account, so the next sign-in links again by email.
 *
 * Needed once when switching Clerk from its development instance to production
 * (docs/DEPLOY.md step 7): Clerk production gives every person a new ID, and the app only
 * links a sign-in to a user whose link is empty (linkIdentityOnFirstSignIn: same email,
 * allowed domain, user INVITED or ACTIVE). Without this, existing users get "no access".
 *
 *   npx tsx scripts/unlink-identities.ts            dry run: lists who would be unlinked
 *   npx tsx scripts/unlink-identities.ts --commit   clears the links (one audit entry per user)
 *
 * Run on Render through SSH, where DATABASE_URL is the web database. Roles, history and all
 * other data are untouched; nobody is signed out of anything but this app.
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

async function main() {
  const commit = process.argv.includes("--commit");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const linked = await c.query<{ id: string; email: string; status: string }>(
      `SELECT id, email, status FROM users WHERE identity_subject IS NOT NULL ORDER BY email`,
    );
    console.log(`${linked.rows.length} user(s) linked to a sign-in account:`);
    for (const u of linked.rows) console.log(`  ${u.email} (${u.status})`);
    if (!commit) {
      console.log("\nDry run only. Nothing changed. Run again with --commit to clear the links.");
      return;
    }
    await c.query("BEGIN");
    try {
      for (const u of linked.rows) {
        await c.query(`UPDATE users SET identity_subject = NULL WHERE id = $1`, [u.id]);
        await c.query(
          `INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, before_state, after_state)
           VALUES (gen_random_uuid(), NULL, 'user.identity_unlinked', 'user', $1, '{"identityLinked": true}'::jsonb, $2::jsonb)`,
          [u.id, JSON.stringify({ identityLinked: false, reason: "Clerk switched from development to production (DEPLOY.md step 7)" })],
        );
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    console.log(`\nDone: ${linked.rows.length} link(s) cleared. Each person's next sign-in links again by email.`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error && e.message ? e.message : e);
  process.exit(1);
});
