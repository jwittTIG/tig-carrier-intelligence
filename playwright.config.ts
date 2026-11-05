import { defineConfig, devices } from "@playwright/test";

// E2E smoke tests. Browsers are not installed yet: run `npx playwright install chromium` once.
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: { command: "npm run dev", url: "http://localhost:3000/api/health", reuseExistingServer: true, timeout: 120_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
