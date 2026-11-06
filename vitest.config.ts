import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Keep test caches and files outside the project folder: writes inside it make a running
// `next dev` rebuild and reload open pages in a loop (seen 2026-11-05: sign-in kept reloading).
const outside = path.join(os.tmpdir(), "tig-carrier-intelligence-tests");

export default defineConfig({
  cacheDir: path.join(outside, "vitest-cache"),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside a React Server bundle; it is a no-op in tests.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    // Vitest's module cache defaults to node_modules/.vitest-cache, which next dev watches.
    fsModuleCachePath: path.join(outside, "module-cache"),
    // Performance tests run on their own (`npm run test:perf`): they load thousands of rows,
    // which the local PGlite database doesn't survive alongside the full suite (DECISIONS D7a).
    include: process.env.PERF ? ["tests/perf/**/*.test.ts"] : ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Run files in a fixed order instead of slowest-first.
    sequence: { shuffle: false },
    globalSetup: ["tests/support/global-setup.ts"],
    setupFiles: ["tests/support/setup-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Integration tests share one test database.
    fileParallelism: false,
  },
});
