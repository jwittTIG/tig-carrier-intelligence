import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { createCarrier } from "@/server/services/carriers";
import * as docs from "@/server/services/documents";
import { startExtraction } from "@/server/services/extractions";
import { applyAndFinish } from "@/server/services/extraction-approval";
import { demoContext } from "../support/auth";
import { testPrisma } from "../support/db";

/** One step from an AI draft to approved or submitted appetite (Josh, 2026-11-16). Development reader: no real AI. */
const db = testPrisma();
let staff: AuthContext;
let admin: AuthContext;
const prevDriver = process.env.AI_DRIVER;
afterAll(async () => {
  if (prevDriver === undefined) delete process.env.AI_DRIVER;
  else process.env.AI_DRIVER = prevDriver;
  await db.$disconnect();
});
beforeAll(async () => {
  process.env.AI_DRIVER = "dev";
  staff = await demoContext(db, "demo.producer@example.invalid");
  admin = await demoContext(db, "demo.admin@example.invalid");
});

const t = () => randomUUID().slice(0, 6);
const pdf = (lines: string[]) => new TextEncoder().encode(`%PDF-1.4\n${lines.map((l) => `% ${l}`).join("\n")}\n% ${Math.random()}\n%%EOF\n`);
const GUIDE = (effective = true) => [
  ...(effective ? ["EFFECTIVE: 2026-01-01"] : []),
  "STATES: TN",
  "RULE: ACCEPTED |  | p3 | Homeowners in Tennessee are eligible.",
  "RULE: PROHIBITED |  | p4 | Vacant dwellings are ineligible.",
];
const ALL = { attributes: [], rules: ["0", "1"], limits: [], requirements: [] };

async function draft(ctx: AuthContext, effective = true) {
  const n = t();
  const carrier = await createCarrier(ctx, { legalName: `TEST OneStep ${n} Co`, displayName: `TEST OneStep ${n}`, type: "INSURER" });
  const line = await db.lineOfBusiness.findUniqueOrThrow({ where: { code: "PERSONAL_HOME" } });
  const product = await db.insuranceProduct.create({ data: { lineId: line.id, code: `TEST_ONE_${n}`, name: `TEST Homeowners ${n}` } });
  const cp = await db.carrierProduct.create({ data: { writingCompanyId: carrier.id, productId: product.id } });
  const guide = await docs.uploadDocument(ctx, { title: `TEST guide ${n}`, documentType: "UNDERWRITING_GUIDELINES", classification: "INTERNAL", organizationId: carrier.id }, { name: "guide.pdf", bytes: pdf(GUIDE(effective)) });
  return startExtraction(ctx, { documentVersionId: guide.version.id, carrierProductId: cp.id });
}

describe("create and approve in one step", () => {
  it("an admin's ticked rules become an approved appetite version, with the typed reason recorded", async () => {
    const ex = await draft(admin);
    const r = await applyAndFinish(admin, ex.id, ALL, { intent: "approve", rationale: "Checked the AI draft page by page against the guide" });
    expect(r.outcome).toBe("approved");
    const p = await db.appetiteProfile.findUniqueOrThrow({ where: { id: r.profileId }, include: { rules: true } });
    expect([p.status, p.approvedById, p.rules.length]).toEqual(["APPROVED", admin.userId, 2]);
    const cr = await db.changeRequest.findFirstOrThrow({ where: { recordId: r.profileId } });
    expect([cr.status, cr.rationale]).toEqual(["APPROVED", "Checked the AI draft page by page against the guide"]);
  });

  it("a missing or short reason, or a non-admin, stops it before anything is created", async () => {
    const ex = await draft(admin);
    await expect(applyAndFinish(admin, ex.id, ALL, { intent: "approve", rationale: "ok" })).rejects.toBeInstanceOf(ValidationError);
    await expect(applyAndFinish(admin, ex.id, ALL, { intent: "approve" })).rejects.toBeInstanceOf(ValidationError);
    const staffEx = await draft(staff);
    await expect(applyAndFinish(staff, staffEx.id, ALL, { intent: "approve", rationale: "Checked against the guide" })).rejects.toBeInstanceOf(ForbiddenError);
    for (const id of [ex.id, staffEx.id]) {
      expect((await db.guideExtraction.findUniqueOrThrow({ where: { id } })).status).toBe("READY");
    }
  });

  it("staff create and submit in one step; it waits for someone else", async () => {
    const ex = await draft(staff);
    const r = await applyAndFinish(staff, ex.id, ALL, { intent: "submit", rationale: "Please check the vacancy rule" });
    expect(r.outcome).toBe("submitted");
    expect((await db.appetiteProfile.findUniqueOrThrow({ where: { id: r.profileId } })).status).toBe("PENDING");
    expect((await db.changeRequest.findFirstOrThrow({ where: { recordId: r.profileId } })).status).toBe("PENDING");
  });

  it("uses the effective date chosen on the review page; without one, the draft is kept and says what's missing", async () => {
    const dated = await draft(admin, false);
    const r1 = await applyAndFinish(admin, dated.id, ALL, { intent: "approve", rationale: "Checked against the guide", effectiveFrom: "2027-02-01" });
    expect(r1.outcome).toBe("approved");
    expect((await db.appetiteProfile.findUniqueOrThrow({ where: { id: r1.profileId } })).effectiveFrom?.toISOString().slice(0, 10)).toBe("2027-02-01");

    const undated = await draft(admin, false);
    const r2 = await applyAndFinish(admin, undated.id, ALL, { intent: "approve", rationale: "Checked against the guide" });
    expect(r2.outcome).toBe("draft");
    expect(r2.stopped).toMatch(/effective date/);
    expect((await db.appetiteProfile.findUniqueOrThrow({ where: { id: r2.profileId } })).status).toBe("DRAFT");
  });

  it("\"draft\" just creates the draft, as before", async () => {
    const ex = await draft(staff);
    const r = await applyAndFinish(staff, ex.id, ALL, { intent: "draft" });
    expect(r.outcome).toBe("draft");
    expect((await db.appetiteProfile.findUniqueOrThrow({ where: { id: r.profileId } })).status).toBe("DRAFT");
  });
});
