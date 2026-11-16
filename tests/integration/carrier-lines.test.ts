import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/errors";
import { createCarrierWithLines, listLines, listProducts } from "@/server/services/carriers";
import { demoContext } from "../support/auth";
import { testPrisma } from "../support/db";

/** Adding a carrier with the lines it writes; personal and commercial lines (Josh, 2026-11-16). */
const db = testPrisma();
let staff: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
});
const t = () => randomUUID().slice(0, 8);
const lineId = async (code: string) => (await db.lineOfBusiness.findUniqueOrThrow({ where: { code } })).id;

describe("lines are personal or commercial", () => {
  it("homeowners, auto, umbrella and flood are personal; the rest commercial", async () => {
    const lines = await listLines(staff);
    const personal = lines.filter((l) => l.segment === "PERSONAL").map((l) => l.code).sort();
    expect(personal).toEqual(["FLOOD", "PERSONAL_AUTO", "PERSONAL_HOME", "PERSONAL_UMBRELLA"]);
    expect(lines.find((l) => l.code === "GENERAL_LIABILITY")?.segment).toBe("COMMERCIAL");
    expect((await listProducts(staff)).every((p) => ["PERSONAL", "COMMERCIAL"].includes(p.line.segment))).toBe(true);
    await expect(db.lineOfBusiness.update({ where: { code: "FLOOD" }, data: { segment: "MARINE" } })).rejects.toThrow();
  });
});

describe("adding a carrier through the form", () => {
  it("an insurer is saved with the lines it writes", async () => {
    const c = await createCarrierWithLines(staff, { legalName: `TEST Lines ${t()} Co`, displayName: `TEST Lines ${t()}`, type: "INSURER", lineIds: [await lineId("PERSONAL_HOME"), await lineId("GENERAL_LIABILITY")] });
    const products = await db.carrierProduct.findMany({ where: { writingCompanyId: c.id }, include: { product: { include: { line: true } } } });
    expect(products.map((p) => p.product.line.code).sort()).toEqual(["GENERAL_LIABILITY", "PERSONAL_HOME"]);
  });

  it("an insurer with no lines is refused, and nothing is saved", async () => {
    const name = `TEST NoLines ${t()}`;
    await expect(createCarrierWithLines(staff, { legalName: `${name} Co`, displayName: name, type: "INSURER", lineIds: [] })).rejects.toThrow(/at least one line/);
    expect(await db.organization.count({ where: { displayName: name } })).toBe(0);
  });

  it("intermediaries don't take lines; a bad line saves nothing", async () => {
    const mga = await createCarrierWithLines(staff, { legalName: `TEST MGA ${t()} Co`, displayName: `TEST MGA ${t()}`, type: "MGA" });
    expect(await db.carrierProduct.count({ where: { writingCompanyId: mga.id } })).toBe(0);
    await expect(createCarrierWithLines(staff, { legalName: `TEST MGA2 ${t()} Co`, displayName: `TEST MGA2 ${t()}`, type: "MGA", lineIds: [await lineId("PERSONAL_HOME")] })).rejects.toBeInstanceOf(ValidationError);
    const name = `TEST BadLine ${t()}`;
    await expect(createCarrierWithLines(staff, { legalName: `${name} Co`, displayName: name, type: "INSURER", lineIds: [randomUUID()] })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.organization.count({ where: { displayName: name } })).toBe(0);
  });
});
