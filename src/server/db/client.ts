import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The single Prisma client for the app.
 *
 * Only services in `src/server/services` use it; pages, route handlers and server actions
 * call those services (enforced by the ESLint rule in eslint.config.mjs).
 *
 * DATABASE_POOL_MAX caps the connection pool. Local `prisma dev` (PGlite) is one Postgres
 * session underneath and is unstable with concurrent connections, so .env.example sets 1.
 */
const globalForPrisma = globalThis as unknown as { tciPrisma?: PrismaClient };

export function poolMax(): number | undefined {
  const n = Number(process.env.DATABASE_POOL_MAX);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: poolMax() }) });
}

export const prisma: PrismaClient = globalForPrisma.tciPrisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.tciPrisma = prisma;
