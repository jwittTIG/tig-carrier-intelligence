import { defineConfig, devices } from "@playwright/test";

// E2E tests against `npm run dev` and the DEV database with the development sign-in.
// One worker and a longer expect timeout: local prisma dev (PGlite) serves one connection at
// a time (DECISIONS D7a), so parallel browsers queue behind each other.
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: { baseURL: "http://localhost:3000" },
  webServer: { command: "npm run dev", url: "http://localhost:3000/api/health", reuseExistingServer: true, timeout: 120_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
