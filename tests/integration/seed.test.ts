import { afterAll, describe, expect, it } from "vitest";
import { excludedLineReason } from "@/lib/taxonomy/scope";
import { testPrisma } from "../support/db";

const db = testPrisma();
afterAll(() => db.$disconnect());

describe("seed", () => {
  it("seeds a P&C-only line taxonomy", async () => {
    const lines = await db.lineOfBusiness.findMany();
    expect(lines.length).toBeGreaterThanOrEqual(20);
    expect(lines.filter((l) => excludedLineReason(l.name))).toEqual([]);
    const codes = lines.map((l) => l.code);
    for (const code of ["GENERAL_LIABILITY", "WORKERS_COMP", "COMMERCIAL_AUTO", "SURETY", "CYBER", "FLOOD"]) expect(codes).toContain(code);
  });

  it("seeds US country, 50 states and DC as territories", async () => {
    expect(await db.territory.count({ where: { countryCode: "US", territoryType: "STATE" } })).toBe(51);
    expect(await db.territory.count({ where: { countryCode: "US", territoryType: "COUNTRY" } })).toBe(1);
  });

  it("seeds STAFF and ADMIN; only ADMIN manages users and settings (DECISIONS D1)", async () => {
    const roles = await db.role.findMany({ include: { permissions: { include: { permission: true } } } });
    const perms = (code: string) => roles.find((r) => r.code === code)!.permissions.map((p) => p.permission.code);
    expect(perms("STAFF")).toContain("commission.read");
    expect(perms("STAFF")).not.toContain("admin.users");
    expect(perms("ADMIN")).toEqual(expect.arrayContaining(["admin.users", "admin.settings", "commission.read"]));
  });

  it("marks every seeded organization, user and code as DEMO / fictional", async () => {
    const orgs = await db.organization.findMany({ where: { NOT: { displayName: { startsWith: "TEST " } } } });
    expect(orgs.length).toBeGreaterThan(0);
    expect(orgs.filter((o) => !o.displayName.startsWith("DEMO ") || !o.legalName.startsWith("DEMO "))).toEqual([]);
    const users = await db.user.findMany({ where: { NOT: { name: { startsWith: "TEST " } } } });
    expect(users.filter((u) => !u.name.startsWith("DEMO ") || !u.email.endsWith("@example.invalid"))).toEqual([]);
    // Codes on seeded (DEMO) carriers are DEMO codes; TEST fixtures create their own carriers.
    const codes = await db.agencyCode.findMany({ where: { appointment: { marketChannel: { carrierProduct: { writingCompany: { displayName: { startsWith: "DEMO " } } } } } } });
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((c) => !c.codeValue.startsWith("DEMO-"))).toEqual([]);
  });

  it("leaves DEMO appetite and commissions unapproved", async () => {
    const demo = { carrierProduct: { writingCompany: { displayName: { startsWith: "DEMO " } } } };
    expect(await db.appetiteProfile.count({ where: { ...demo, status: "APPROVED" } })).toBe(0);
    // TEST fixtures share the DEMO agency entity, so scope by DEMO carrier.
    expect(await db.commissionSchedule.count({ where: { agreement: { marketChannel: demo }, status: "APPROVED" } })).toBe(0);
  });

  it("seeds settings with the appetite disclaimer", async () => {
    const s = await db.appSetting.findUniqueOrThrow({ where: { key: "search.disclaimer" } });
    expect(String(s.value)).toMatch(/not a commitment to quote or bind/);
  });
});
