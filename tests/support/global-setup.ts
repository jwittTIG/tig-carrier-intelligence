import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import pg from "pg";

/**
 * Before the run: empty the TEST database, apply migrations, seed.
 *
 * This wipes the test database on every run. Guards: only TEST_DATABASE_URL is touched;
 * it must differ from DATABASE_URL and point at localhost (CI sets ALLOW_REMOTE_TEST_DB=1
 * for its throwaway service container). Never point TEST_DATABASE_URL at real data.
 */
export default async function setup() {
  config({ path: ".env.local", quiet: true });
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is missing (see .env.example)");
  if (testUrl === process.env.DATABASE_URL) throw new Error("Refusing to reset: TEST_DATABASE_URL equals DATABASE_URL");
  const host = new URL(testUrl).hostname;
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(`Refusing to reset a non-local test database (${host})`);
  }

  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  try {
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }

  const env = { ...process.env, DATABASE_URL: testUrl, NODE_NO_WARNINGS: "1" };
  for (const cmd of ["npx prisma migrate deploy", "npx tsx prisma/seed.ts"]) {
    const r = spawnSync(cmd, { stdio: "inherit", shell: true, env });
    if (r.status !== 0) throw new Error(`Test DB setup failed: ${cmd}`);
  }
}
