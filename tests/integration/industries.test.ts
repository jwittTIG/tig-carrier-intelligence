import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import * as industries from "@/server/services/industries";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";

/** NAICS reference data and staff-added search words (DECISIONS N16, N17). */
const db = testPrisma();
let staff: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
});

describe("NAICS reference data", () => {
  it("the seed loads the 2022 NAICS list with titles and levels", async () => {
    expect(await db.industryCode.count({ where: { classificationSystem: "NAICS" } })).toBe(2125);
    expect(await db.industryCode.findUnique({ where: { classificationSystem_code: { classificationSystem: "NAICS", code: "238160" } } })).toMatchObject({ title: "Roofing Contractors", level: 6, sourceVersion: "NAICS 2022" });
    expect((await db.industryCode.findUnique({ where: { classificationSystem_code: { classificationSystem: "NAICS", code: "31-33" } } }))?.level).toBe(2);
  });

  it("a code page shows its groups and the industries under a group", async () => {
    const roofing = await industries.getIndustry(staff, "NAICS", "238160");
    expect(roofing.parents.map((p) => p.code)).toEqual(["23", "238", "2381", "23816"]);
    const group = await industries.getIndustry(staff, "NAICS", "2381");
    expect(group.children.map((c) => c.code)).toContain("23816");
    await expect(industries.getIndustry(staff, "NAICS", "999999")).rejects.toBeInstanceOf(NotFoundError);
    await expect(industries.getIndustry(staff, "SIC", "1761")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("search words", () => {
  it("“hvac” finds nothing until staff add it, then finds the code directly", async () => {
    await expect(industries.resolveIndustry(staff, "hvac")).rejects.toThrow(/No NAICS industry matches "hvac"/);
    const row = await industries.addKeyword(staff, "NAICS", "238220", { keyword: "  HVAC  " });
    expect(row.keyword).toBe("hvac");
    expect(await industries.resolveIndustry(staff, "hvac")).toEqual({ kind: "code", classificationSystem: "NAICS", code: "238220", title: "Plumbing, Heating, and Air-Conditioning Contractors", matchedWords: "hvac" });
    // Words can mix the search word and the title.
    expect((await industries.searchIndustries(staff, "hvac contractors")).map((c) => c.code)).toContain("238220");
    const listed = (await industries.searchIndustries(staff, "hvac")).find((c) => c.code === "238220");
    expect(listed?.keywords).toEqual(["hvac"]);
    expect(await db.auditEvent.count({ where: { action: "industry.keyword.add", entityId: row.id } })).toBe(1);

    await industries.removeKeyword(staff, row.id);
    await expect(industries.resolveIndustry(staff, "hvac")).rejects.toThrow(/No NAICS industry matches/);
    expect(await db.auditEvent.count({ where: { action: "industry.keyword.remove", entityId: row.id } })).toBe(1);
  });

  it("rejects duplicates, bad words and unknown codes", async () => {
    await industries.addKeyword(staff, "NAICS", "238310", { keyword: "drywall" });
    await expect(industries.addKeyword(staff, "NAICS", "238310", { keyword: "Drywall" })).rejects.toBeInstanceOf(ConflictError);
    await expect(industries.addKeyword(staff, "NAICS", "238310", { keyword: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(industries.addKeyword(staff, "NAICS", "238310", { keyword: "<script>" })).rejects.toBeInstanceOf(ValidationError);
    await expect(industries.addKeyword(staff, "NAICS", "999999", { keyword: "nothing" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(industries.removeKeyword(staff, "11111111-1111-4111-8111-111111111111")).rejects.toBeInstanceOf(NotFoundError);
    // The same word on another code is allowed (staff then choose).
    await industries.addKeyword(staff, "NAICS", "238390", { keyword: "drywall" });
    const r = await industries.resolveIndustry(staff, "drywall");
    expect(r.kind).toBe("choices");
  });

  it("adding needs appetite.write; searching needs appetite.read", async () => {
    const reader = await limitedUser(db, ["appetite.read"]);
    await expect(industries.addKeyword(reader, "NAICS", "238160", { keyword: "roof guys" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await industries.searchIndustries(reader, "roofing")).length).toBeGreaterThan(0);
    const none = await limitedUser(db, ["carrier.read"]);
    await expect(industries.searchIndustries(none, "roofing")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the database keeps search words lowercase and trimmed", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: "demo.producer@example.invalid" } });
    await expect(db.industryKeyword.create({ data: { classificationSystem: "NAICS", code: "238160", keyword: "Roof Guys", createdById: user.id } })).rejects.toThrow();
    await expect(db.industryKeyword.create({ data: { classificationSystem: "NAICS", code: "238160", keyword: " roofs", createdById: user.id } })).rejects.toThrow();
  });
});
