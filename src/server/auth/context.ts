import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import { ForbiddenError } from "@/server/errors";
import type { PermissionCode, RoleCode } from "./catalog";

/** The signed-in user, as services see it. No Clerk or Next.js imports, so services stay testable. */
export type AuthContext = {
  userId: string;
  email: string;
  name: string;
  roles: RoleCode[];
  permissions: ReadonlySet<PermissionCode>;
  /** Ties together the audit rows written while serving one request. */
  correlationId: string;
};

export function can(ctx: AuthContext, permission: PermissionCode): boolean {
  return ctx.permissions.has(permission);
}

/** Default deny: throws unless the user's roles grant `permission`. */
export function assertCan(ctx: AuthContext, permission: PermissionCode): void {
  if (!can(ctx, permission)) throw new ForbiddenError(`Missing permission: ${permission}`);
}

/**
 * Builds the context for a user id, or null if the user is missing or not ACTIVE.
 * Permissions come from the database (user_role_scopes → roles → permissions).
 * Scoped grants (agency entity / business unit / line) are not used yet (D1).
 */
export async function loadAuthContext(userId: string, correlationId: string = randomUUID()): Promise<AuthContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roleScopes: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!user || user.status !== "ACTIVE") return null;
  const permissions = new Set<PermissionCode>();
  for (const scope of user.roleScopes) for (const rp of scope.role.permissions) permissions.add(rp.permission.code as PermissionCode);
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    roles: [...new Set(user.roleScopes.map((s) => s.role.code as RoleCode))],
    permissions,
    correlationId,
  };
}
