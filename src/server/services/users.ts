import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";
import { ROLE_CODES, type RoleCode } from "@/server/auth/catalog";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parse, requiredText } from "@/server/validation";

/** Domains allowed to sign in and be invited, from ALLOWED_EMAIL_DOMAINS (comma-separated). */
export function allowedDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function emailDomainAllowed(email: string): boolean {
  const domain = email.split("@").pop()?.toLowerCase() ?? "";
  return allowedDomains().includes(domain);
}

/**
 * First Microsoft sign-in: link the identity-provider subject to an invited user with the
 * same email. Invite-only (DECISIONS D18): unknown or deactivated people get no access.
 * Returns the user id, or null.
 */
export async function linkIdentityOnFirstSignIn(subject: string, email: string): Promise<string | null> {
  if (!emailDomainAllowed(email)) return null;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      select id from users where lower(email) = lower(${email}) and identity_subject is null and status in ('INVITED', 'ACTIVE') for update`;
    const id = rows[0]?.id;
    if (!id) return null;
    const after = await tx.user.update({ where: { id }, data: { identitySubject: subject, status: "ACTIVE" } });
    await tx.auditEvent.create({
      data: { actorId: id, action: "user.first_sign_in", entityType: "user", entityId: id, afterState: { status: after.status, identityLinked: true } },
    });
    return id;
  });
}

export async function listUsers(ctx: AuthContext) {
  assertCan(ctx, "admin.users");
  const users = await prisma.user.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { roleScopes: { include: { role: true } } } });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status,
    signedInBefore: u.identitySubject !== null,
    role: (u.roleScopes[0]?.role.code ?? null) as RoleCode | null,
  }));
}

/** Active users, for owner pickers. */
export async function listActiveUsers(ctx: AuthContext) {
  assertCan(ctx, "carrier.read");
  return prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

const inviteSchema = z.object({
  name: requiredText(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  role: z.enum(ROLE_CODES as [RoleCode, ...RoleCode[]]),
});

export async function inviteUser(ctx: AuthContext, input: unknown) {
  assertCan(ctx, "admin.users");
  const data = parse(inviteSchema, input);
  if (!emailDomainAllowed(data.email)) throw new ValidationError(`Only ${allowedDomains().join(", ") || "configured"} email addresses can be invited.`);
  try {
    return await prisma.$transaction(async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { code: data.role } });
      const user = await tx.user.create({ data: { name: data.name, email: data.email, status: "INVITED" } });
      await tx.userRoleScope.create({ data: { userId: user.id, roleId: role.id } });
      await recordAudit(tx, ctx, { action: "user.invite", entityType: "user", entityId: user.id, after: { ...user, role: data.role } });
      return user;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictError("A user with that email already exists.");
    throw e;
  }
}

async function activeAdminCount(tx: Prisma.TransactionClient, excludingUserId: string) {
  return tx.user.count({ where: { id: { not: excludingUserId }, status: "ACTIVE", roleScopes: { some: { role: { code: "ADMIN" } } } } });
}

export async function setUserRole(ctx: AuthContext, userId: string, role: unknown) {
  assertCan(ctx, "admin.users");
  const code = parse(z.enum(ROLE_CODES as [RoleCode, ...RoleCode[]]), role);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { roleScopes: { include: { role: true } } } });
    if (!user) throw new NotFoundError("User not found.");
    const before = user.roleScopes.map((s) => s.role.code);
    if (before.includes("ADMIN") && code !== "ADMIN" && (await activeAdminCount(tx, userId)) === 0) {
      throw new ConflictError("There must be at least one active admin.");
    }
    const r = await tx.role.findUniqueOrThrow({ where: { code } });
    await tx.userRoleScope.deleteMany({ where: { userId } });
    await tx.userRoleScope.create({ data: { userId, roleId: r.id } });
    await recordAudit(tx, ctx, { action: "user.set_role", entityType: "user", entityId: userId, before: { roles: before }, after: { roles: [code] } });
  });
}

export async function setUserActive(ctx: AuthContext, userId: string, active: boolean) {
  assertCan(ctx, "admin.users");
  if (!active && userId === ctx.userId) throw new ConflictError("You can't deactivate yourself.");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { roleScopes: { include: { role: true } } } });
    if (!user) throw new NotFoundError("User not found.");
    const isAdmin = user.roleScopes.some((s) => s.role.code === "ADMIN");
    if (!active && isAdmin && (await activeAdminCount(tx, userId)) === 0) throw new ConflictError("There must be at least one active admin.");
    // Reactivating someone who never signed in puts them back to INVITED.
    const status = active ? (user.identitySubject ? "ACTIVE" : "INVITED") : "DEACTIVATED";
    const after = await tx.user.update({ where: { id: userId }, data: { status } });
    await recordAudit(tx, ctx, { action: active ? "user.reactivate" : "user.deactivate", entityType: "user", entityId: userId, before: { status: user.status }, after: { status: after.status } });
  });
}
