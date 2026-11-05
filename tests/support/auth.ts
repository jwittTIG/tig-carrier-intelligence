import { randomUUID } from "node:crypto";
import { loadAuthContext, type AuthContext } from "@/server/auth/context";
import type { PrismaClient } from "@/generated/prisma/client";

/** Context for a seeded DEMO user, built exactly as the app builds it. */
export async function demoContext(db: PrismaClient, email: "demo.admin@example.invalid" | "demo.producer@example.invalid"): Promise<AuthContext> {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const ctx = await loadAuthContext(user.id);
  if (!ctx) throw new Error(`No context for ${email}`);
  return ctx;
}

/** A fresh TEST user with the given role (or none) and status. */
export async function testUser(db: PrismaClient, opts: { role?: "STAFF" | "ADMIN" | null; status?: "ACTIVE" | "INVITED" | "DEACTIVATED"; email?: string } = {}) {
  const t = randomUUID().slice(0, 8);
  const user = await db.user.create({ data: { name: `TEST User ${t}`, email: opts.email ?? `test.${t}@example.invalid`, status: opts.status ?? "ACTIVE" } });
  if (opts.role !== null) {
    const role = await db.role.findUniqueOrThrow({ where: { code: opts.role ?? "STAFF" } });
    await db.userRoleScope.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user;
}
