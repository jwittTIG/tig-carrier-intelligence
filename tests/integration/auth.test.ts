import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadAuthContext } from "@/server/auth/context";
import { ForbiddenError } from "@/server/errors";
import { listCarriers } from "@/server/services/carriers";
import { linkIdentityOnFirstSignIn } from "@/server/services/users";
import { testPrisma } from "../support/db";
import { testUser } from "../support/auth";

const db = testPrisma();
afterAll(() => db.$disconnect());

describe("auth context", () => {
  it("loads permissions from the database for ACTIVE users", async () => {
    const admin = await testUser(db, { role: "ADMIN" });
    const staff = await testUser(db, { role: "STAFF" });
    const a = (await loadAuthContext(admin.id))!;
    const s = (await loadAuthContext(staff.id))!;
    expect(a.permissions.has("admin.users")).toBe(true);
    expect(s.permissions.has("admin.users")).toBe(false);
    expect(s.permissions.has("commission.read")).toBe(true); // D1: everyone sees everything
  });

  it("returns no context for invited, deactivated or unknown users", async () => {
    const invited = await testUser(db, { status: "INVITED" });
    const gone = await testUser(db, { status: "DEACTIVATED" });
    expect(await loadAuthContext(invited.id)).toBeNull();
    expect(await loadAuthContext(gone.id)).toBeNull();
    expect(await loadAuthContext(randomUUID())).toBeNull();
  });

  it("default deny: an active user with no role can read nothing", async () => {
    const noRole = await testUser(db, { role: null });
    const ctx = (await loadAuthContext(noRole.id))!;
    expect(ctx.permissions.size).toBe(0);
    await expect(listCarriers(ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("first Microsoft sign-in", () => {
  it("links an invited user by email (any case), activates them, and audits it", async () => {
    const u = await testUser(db, { status: "INVITED" });
    const subject = `user_${randomUUID()}`;
    expect(await linkIdentityOnFirstSignIn(subject, u.email.toUpperCase())).toBe(u.id);
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.identitySubject).toBe(subject);
    expect(await db.auditEvent.count({ where: { entityId: u.id, action: "user.first_sign_in" } })).toBe(1);
  });

  it("refuses uninvited, deactivated, already-linked and other-domain accounts", async () => {
    expect(await linkIdentityOnFirstSignIn(`user_${randomUUID()}`, `nobody.${randomUUID().slice(0, 6)}@example.invalid`)).toBeNull();
    const gone = await testUser(db, { status: "DEACTIVATED" });
    expect(await linkIdentityOnFirstSignIn(`user_${randomUUID()}`, gone.email)).toBeNull();
    const linked = await testUser(db, { status: "INVITED" });
    await linkIdentityOnFirstSignIn("user_first", linked.email);
    expect(await linkIdentityOnFirstSignIn("user_second", linked.email)).toBeNull();
    const outside = await testUser(db, { status: "INVITED", email: `x.${randomUUID().slice(0, 6)}@other-domain.test` });
    expect(await linkIdentityOnFirstSignIn(`user_${randomUUID()}`, outside.email)).toBeNull();
  });
});
