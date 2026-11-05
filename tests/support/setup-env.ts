import { config } from "dotenv";
import { afterAll } from "vitest";

// Tests never touch the dev database.
config({ path: ".env.local", quiet: true });
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is missing (see .env.example)");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.STORAGE_DRIVER = "dev";
process.env.AUTH_DRIVER = "dev";
process.env.ALLOWED_EMAIL_DOMAINS = "example.invalid";
process.env.DATABASE_POOL_MAX ??= "1";
process.env.DEV_STORAGE_DIR = ".data/test-storage";
process.env.STORAGE_SIGNING_SECRET ??= "test-signing-secret-0123456789abcdef0123456789abcdef";

// Close the app's connection pool when each test file finishes. Without this, the worker exits
// with the connection still open, and local PGlite (DECISIONS D7a) sometimes doesn't survive
// the abrupt disconnect.
afterAll(async () => {
  const g = globalThis as unknown as { tciPrisma?: { $disconnect(): Promise<void> } };
  await g.tciPrisma?.$disconnect();
});
