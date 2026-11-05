import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAuthContext, type AuthContext } from "@/server/auth/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { inviteUser, listUsers, setUserActive, setUserRole } from "@/server/services/users";
import { demoContext, testUser } from "../support/auth";
import { testPrisma } from "../support/db";

const db = testPrisma();
let admin: AuthContext;
let staff: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  admin = await demoContext(db, "demo.admin@example.invalid");
  staff = await demoContext(db, "demo.producer@example.invalid");
});

describe("user administration", () => {
  it("only admins can list, invite, change roles or deactivate", async () => {
    await expect(listUsers(staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteUser(staff, { name: "x", email: "x@example.invalid", role: "STAFF" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setUserRole(staff, admin.userId, "STAFF")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setUserActive(staff, admin.userId, false)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("invites only allowed domains, rejects duplicates, and audits", async () => {
    const email = `new.${randomUUID().slice(0, 6)}@example.invalid`;
    const u = await inviteUser(admin, { name: "TEST Invitee", email: email.toUpperCase(), role: "STAFF" });
    expect(u.status).toBe("INVITED");
    expect(u.email).toBe(email);
    expect(await db.auditEvent.count({ where: { entityId: u.id, action: "user.invite", actorId: admin.userId } })).toBe(1);
    await expect(inviteUser(admin, { name: "Dup", email, role: "STAFF" })).rejects.toBeInstanceOf(ConflictError);
    await expect(inviteUser(admin, { name: "Outsider", email: "someone@gmail.com", role: "STAFF" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("deactivation removes access immediately; reactivation restores it", async () => {
    const u = await testUser(db, { role: "STAFF" });
    expect(await loadAuthContext(u.id)).not.toBeNull();
    await setUserActive(admin, u.id, false);
    expect(await loadAuthContext(u.id)).toBeNull();
    await setUserActive(admin, u.id, true);
    // Never signed in through Microsoft, so back to INVITED (no session until first sign-in).
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("INVITED");
  });

  it("you can't deactivate yourself, and the last active admin can't be removed", async () => {
    await expect(setUserActive(admin, admin.userId, false)).rejects.toBeInstanceOf(ConflictError);
    const others = await db.user.findMany({ where: { id: { not: admin.userId }, status: "ACTIVE", roleScopes: { some: { role: { code: "ADMIN" } } } } });
    for (const o of others) await setUserActive(admin, o.id, false);
    await expect(setUserRole(admin, admin.userId, "STAFF")).rejects.toBeInstanceOf(ConflictError);
    for (const o of others) await setUserActive(admin, o.id, true);
  });

  it("changing a role changes permissions and is audited", async () => {
    const u = await testUser(db, { role: "STAFF" });
    await setUserRole(admin, u.id, "ADMIN");
    expect((await loadAuthContext(u.id))!.permissions.has("admin.users")).toBe(true);
    const a = await db.auditEvent.findFirstOrThrow({ where: { entityId: u.id, action: "user.set_role" } });
    expect(a.beforeState).toEqual({ roles: ["STAFF"] });
    expect(a.afterState).toEqual({ roles: ["ADMIN"] });
  });
});
