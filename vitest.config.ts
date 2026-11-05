import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside a React Server bundle; it is a no-op in tests.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
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
