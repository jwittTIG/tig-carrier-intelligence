import { describe, expect, it } from "vitest";
import { ROLES } from "@/server/auth/catalog";
import { assertCan, can, type AuthContext } from "@/server/auth/context";
import { ForbiddenError } from "@/server/errors";

const ctx = (perms: string[]): AuthContext =>
  ({ userId: "u", email: "e", name: "n", roles: [], permissions: new Set(perms), correlationId: "c" }) as unknown as AuthContext;

describe("permissions", () => {
  it("default deny: no permissions means every check fails", () => {
    expect(can(ctx([]), "carrier.read")).toBe(false);
    expect(() => assertCan(ctx([]), "carrier.read")).toThrow(ForbiddenError);
  });
  it("grants exactly what is listed", () => {
    expect(() => assertCan(ctx(["carrier.read"]), "carrier.read")).not.toThrow();
    expect(can(ctx(["carrier.read"]), "carrier.write")).toBe(false);
  });
  it("STAFF has everything except user/settings admin (D1); ADMIN has all", () => {
    const staff = ROLES.find((r) => r.code === "STAFF")!.permissions as readonly string[];
    expect(staff).toContain("commission.read");
    expect(staff).toContain("appointment.read");
    expect(staff).not.toContain("admin.users");
    expect(ROLES.find((r) => r.code === "ADMIN")!.permissions).toContain("admin.users");
  });
});
