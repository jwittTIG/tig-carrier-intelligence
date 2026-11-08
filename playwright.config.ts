import os from "node:os";
import path from "node:path";
import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests run against their OWN dev server (port 3100) and the TEST database, never the
 * dev database where staff enter real data. `npm run test:e2e` first resets and seeds the test
 * database with DEMO records (scripts/e2e-prepare.ts), then starts this server with:
 * - DATABASE_URL = TEST_DATABASE_URL,
 * - its own build folder (.next-e2e) so it doesn't disturb `npm run dev`,
 * - mailbox and file storage folders in the system temp folder.
 * One worker and a longer expect timeout: local prisma dev (PGlite) serves one connection at
 * a time (DECISIONS D7a).
 */
config({ path: ".env.local", quiet: true });
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error("TEST_DATABASE_URL is missing (see .env.example)");
if (testDb === process.env.DATABASE_URL) throw new Error("Refusing: TEST_DATABASE_URL equals DATABASE_URL");

const scratch = path.join(os.tmpdir(), "tig-carrier-intelligence-e2e");
// Read by the specs that drop .eml files into the test mailbox.
process.env.E2E_INBOX_DIR = path.join(scratch, "inbox");
const port = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npx next dev -p ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: testDb,
      NEXT_DIST_DIR: ".next-e2e",
      AUTH_DRIVER: "dev",
      STORAGE_DRIVER: "dev",
      DEV_STORAGE_DIR: path.join(scratch, "storage"),
      MAIL_INTAKE_DRIVER: "dev",
      MAIL_INTAKE_DEV_DIR: process.env.E2E_INBOX_DIR,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
