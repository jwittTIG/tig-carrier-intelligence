/**
 * Wipes the LOCAL dev database and reloads reference data only (no DEMO records).
 * Destructive: everything in it is deleted, including the audit log. Run only with Josh's OK.
 *
 *   npx tsx scripts/reset-dev-db.ts --yes-delete-everything
 *
 * Guards: DATABASE_URL must point at localhost and differ from TEST_DATABASE_URL.
 * Afterwards run scripts/bootstrap.ts to create the first Admin and the agency entity.
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

async function main() {
  if (!process.argv.includes("--yes-delete-everything")) throw new Error("This deletes all data in the dev database. Re-run with --yes-delete-everything.");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url === process.env.TEST_DATABASE_URL) throw new Error("DATABASE_URL equals TEST_DATABASE_URL");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) throw new Error(`Refusing to wipe a non-local database (${host})`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }
  const env = { ...process.env, SEED_DEMO: "0", NODE_NO_WARNINGS: "1" };
  for (const cmd of ["npx prisma migrate deploy", "npx tsx prisma/seed.ts"]) {
    const r = spawnSync(cmd, { stdio: "inherit", shell: true, env });
    if (r.status !== 0) throw new Error(`Failed: ${cmd}`);
  }
  console.log("Dev database wiped and reference data loaded (no DEMO records).");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
