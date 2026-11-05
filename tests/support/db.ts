import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";

/** Prisma client on the test DB, for building fixtures. */
export function testPrisma() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }) });
}

/** Raw pg client, so tests can assert exact Postgres error codes. */
export async function testPg() {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL! });
  await client.connect();
  return client;
}

export const PG = {
  CHECK_VIOLATION: "23514",
  EXCLUSION_VIOLATION: "23P01",
  FOREIGN_KEY_VIOLATION: "23503",
  UNIQUE_VIOLATION: "23505",
  INSUFFICIENT_PRIVILEGE: "42501",
} as const;

/** Runs `sql` and returns the Postgres error code it fails with (or null if it succeeds). */
export async function pgErrorCode(client: pg.Client, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await client.query(sql, params);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
}
