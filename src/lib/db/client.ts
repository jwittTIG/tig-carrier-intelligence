import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The single Prisma client for the app.
 *
 * Milestone 1 has no authorization layer yet. From Milestone 2 on, route handlers and
 * server actions must not import this directly: they call services that take an
 * authenticated context and check permissions (lint rule to be added in M2).
 */
const globalForPrisma = globalThis as unknown as { tciPrisma?: PrismaClient };

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma: PrismaClient = globalForPrisma.tciPrisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.tciPrisma = prisma;
