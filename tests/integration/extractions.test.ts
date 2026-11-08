import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAuthContext, type AuthContext } from "@/server/auth/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { submitProfile } from "@/server/services/appetite";
import { decide } from "@/server/services/approvals";
import { createCarrier } from "@/server/services/carriers";
import * as docs from "@/server/services/documents";
import * as ex from "@/server/services/extractions";
import { findMarkets, riskAttributesFor } from "@/server/services/market";
import { demoContext, limitedUser, testUser } from "../support/auth";
import { testPrisma } from "../support/db";

/** AI-drafted appetite (M9) with the development reader: no real AI calls. */
const db = testPrisma();
let staff: AuthContext;
let reviewer: AuthContext;
const prevDriver = process.env.AI_DRIVER;
afterAll(async () => {
  if (prevDriver === undefined) delete process.env.AI_DRIVER;
  else process.env.AI_DRIVER = prevDriver;
  await db.$disconnect();
});
beforeAll(async () => {
  process.env.AI_DRIVER = "dev";
  staff = await demoContext(db, "demo.producer@example.invalid");
  reviewer = (await loadAuthContext((await testUser(db, { role: "STAFF" })).id))!;
});

const t = () => randomUUID().slice(0, 6);
const pdf = (lines: string[]) => new TextEncoder().encode(`%PDF-1.4\n${lines.map((l) => `% ${l}`).join("\n")}\n% ${Math.random()}\n%%EOF\n`);

const GUIDE = [
  "EFFECTIVE: 2026-01-01",
  "STATES: TN",
  "ATTR: roof_covering | Roof covering | ENUM | Asphalt shingle,Metal,Wood shake,Wood shingle | p8 | Roof covering of wood shakes or wood shingles",
  "ATTR: roof_age | Roof age | INTEGER |  | p9 | Roofs older than 20 years",
  "RULE: ACCEPTED |  | p3 | Homeowners in Tennessee are eligible.",
  "RULE: PROHIBITED | roof_covering IN Wood shake,Wood shingle | p8 | Wood shake roofs are ineligible.",
  "RULE: REFERRAL | roof_age GT 20 | p9 | Roofs older than 20 years refer to underwriting maybe",
  "RULE: PROHIBITED | roof_covering IN Thatch | p8 | Thatch roofs are ineligible.",
  "RULE: PROHIBITED | pool_fence EQ no | p10 | Unfenced pools are ineligible.",
  "LIMIT: Coverage A | 100000 | 1500000 | p5 | Coverage A from $100,000 to $1,500,000",
  "REQ: Deductible | Minimum all-perils deductible is $1,000 | p6",
  "REQ: Required form | Wind/hail endorsement required in coastal counties | p6",
];

async function setup(lines = GUIDE, o: { classification?: string } = {}) {
  const n = t();
  const carrier = await createCarrier(staff, { legalName: `TEST Extract ${n} Co`, displayName: `TEST Extract ${n}`, type: "INSURER" });
  const line = await db.lineOfBusiness.findUniqueOrThrow({ where: { code: "PERSONAL_HOME" } });
  const product = await db.insuranceProduct.create({ data: { lineId: line.id, code: `TEST_HO_${n}`, name: `TEST Homeowners ${n}` } });
  const cp = await db.carrierProduct.create({ data: { writingCompanyId: carrier.id, productId: product.id } });
  const guide = await docs.uploadDocument(staff, { title: `TEST HO guide ${n}`, documentType: "UNDERWRITING_GUIDELINES", classification: o.classification ?? "INTERNAL", organizationId: carrier.id }, { name: "guide.pdf", bytes: pdf(lines) });
  return { carrier, product, cp, guide };
}

describe("drafting appetite from a guide", () => {
  it("stores the AI's proposals for review without changing any appetite", async () => {
    const s = await setup();
    const run = await ex.startExtraction(staff, { documentVersionId: s.guide.version.id, carrierProductId: s.cp.id });
    expect(run.status).toBe("READY");
    const got = await ex.getExtraction(staff, run.id);
    expect(got.proposals).toMatchObject({ effectiveDate: "2026-01-01", states: ["TN"] });
    expect([got.proposals!.attributes.length, got.proposals!.rules.length, got.proposals!.limits.length, got.proposals!.requirements.length]).toEqual([2, 5, 1, 2]);
    expect(await db.appetiteProfile.count({ where: { carrierProductId: s.cp.id } })).toBe(0);
    expect(await db.auditEvent.count({ where: { entityId: run.id, action: "appetite.extraction.run" } })).toBe(1);
    expect((await ex.draftTargets(staff, s.guide.document.id)).map((x) => x.id)).toEqual([s.cp.id]);
  });

  it("applies only what was ticked, into a draft, with AI sources; skips what doesn't fit, with reasons", async () => {
    const s = await setup();
    const run = await ex.startExtraction(staff, { documentVersionId: s.guide.version.id, carrierProductId: s.cp.id });
    // Keep "Roof covering" but not "Roof age"; all rules; the limit; only the required form.
    const r = await ex.applyExtraction(staff, run.id, { attributes: ["0"], rules: ["0", "1", "2", "3", "4"], limits: ["0"], requirements: ["1"] });
    expect(r.added).toEqual({ riskDetails: 1, rules: 2, limits: 1, requirements: 1 });
    expect(r.skipped.map((x) => x.reason)).toEqual([
      expect.stringMatching(/Needs the risk detail "roof_age"/),
      expect.stringMatching(/"Thatch" isn't one of the allowed values for Roof covering/),
      expect.stringMatching(/Needs the risk detail "pool_fence"/),
    ]);

    const profile = await db.appetiteProfile.findUniqueOrThrow({ where: { id: r.profileId }, include: { rules: true } });
    expect(profile.status).toBe("DRAFT"); // never approved by the AI
    expect(profile.effectiveFrom?.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(profile.rules.map((x) => x.outcome).sort()).toEqual(["ACCEPTED", "PROHIBITED"]);
    const prohibit = profile.rules.find((x) => x.outcome === "PROHIBITED")!;
    const src = await db.recordSource.findFirstOrThrow({ where: { recordType: "APPETITE_RULE", recordId: prohibit.id } });
    expect(src).toMatchObject({ sourceKind: "AI_EXTRACTED", documentVersionId: s.guide.version.id, pageOrSection: "p. 8" });
    expect(Number(src.confidence)).toBeCloseTo(0.9);
    expect(src.sourceNote).toMatch(/Wood shake roofs are ineligible/);
    expect(await db.recordSource.count({ where: { recordType: "APPETITE_PROFILE", recordId: profile.id, sourceKind: "DOCUMENT", documentVersionId: s.guide.version.id } })).toBe(1);

    const def = await db.riskAttributeDefinition.findUniqueOrThrow({ where: { productId_key: { productId: s.product.id, key: "roof_covering" } } });
    expect(def.validationSchema).toEqual({ values: ["Asphalt shingle", "Metal", "Wood shake", "Wood shingle"] });
    expect(await db.riskAttributeDefinition.count({ where: { productId: s.product.id, key: "roof_age" } })).toBe(0);
    const cov = await db.coverageCapability.findFirstOrThrow({ where: { carrierProductId: s.cp.id } });
    expect([cov.coverageCode, Number(cov.minLimit), Number(cov.maxLimit)]).toEqual(["Coverage A", 100000, 1500000]);
    expect((await db.underwritingRequirement.findMany({ where: { carrierProductId: s.cp.id } })).map((q) => q.requirementType)).toEqual(["Required form"]);

    expect((await db.guideExtraction.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("APPLIED");
    await expect(ex.applyExtraction(staff, run.id, { rules: ["0"] })).rejects.toBeInstanceOf(ConflictError);
  });

  it("once approved, the Market Finder answers from the guide (and asks for the detail it needs)", async () => {
    const s = await setup();
    const run = await ex.startExtraction(staff, { documentVersionId: s.guide.version.id, carrierProductId: s.cp.id });
    const r = await ex.applyExtraction(staff, run.id, { attributes: ["0", "1"], rules: ["0", "1", "2"], limits: [], requirements: [] });
    expect(r.added.rules).toBe(3);
    await submitProfile(staff, r.profileId, {});
    const cr = await db.changeRequest.findFirstOrThrow({ where: { recordId: r.profileId, status: "PENDING" } });
    await decide(reviewer, cr.id, { decision: "APPROVE" });

    const attrs = await riskAttributesFor(staff, { productId: s.product.id });
    expect(attrs.find((a) => a.key === "roof_covering")?.allowedValues).toEqual(["Asphalt shingle", "Metal", "Wood shake", "Wood shingle"]);
    const outcome = async (risk: Record<string, string>) => {
      const res = await findMarkets(staff, { productId: s.product.id, stateCode: "TN", ...risk });
      return res.groups.find((g) => g.results.some((x) => x.carrier.id === s.carrier.id))?.outcome;
    };
    expect(await outcome({ a_roof_covering: "Wood shake", a_roof_age: "5" })).toBe("PROHIBITED");
    expect(await outcome({ a_roof_covering: "Metal", a_roof_age: "5" })).toBe("ACCEPTED");
    expect(await outcome({ a_roof_covering: "Metal", a_roof_age: "25" })).toBe("REFERRAL");
    expect(await outcome({})).toBe("NEEDS_INFO"); // missing details are never treated as acceptable
  });

  it("refuses restricted or non-PDF documents, and needs appetite.write", async () => {
    const restricted = await setup(GUIDE, { classification: "RESTRICTED" });
    await expect(ex.startExtraction(staff, { documentVersionId: restricted.guide.version.id, carrierProductId: restricted.cp.id })).rejects.toThrow(/Restricted documents are never sent/);
    const s = await setup();
    const reader = await limitedUser(db, ["appetite.read", "document.read"]);
    await expect(ex.startExtraction(reader, { documentVersionId: s.guide.version.id, carrierProductId: s.cp.id })).rejects.toBeInstanceOf(ForbiddenError);
    const run = await ex.startExtraction(staff, { documentVersionId: s.guide.version.id, carrierProductId: s.cp.id });
    await expect(ex.applyExtraction(reader, run.id, { rules: ["0"] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("logs a failed read, and explains when AI isn't set up", async () => {
    const s = await setup();
    await db.documentVersion.update({ where: { id: s.guide.version.id }, data: { objectKey: `documents/missing/${randomUUID()}` } });
    const run = await ex.startExtraction(staff, { documentVersionId: s.guide.version.id, carrierProductId: s.cp.id });
    expect(run.status).toBe("FAILED");
    expect(run.error).toBeTruthy();
    await expect(ex.applyExtraction(staff, run.id, {})).rejects.toBeInstanceOf(ConflictError);

    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_DRIVER = "";
    try {
      const s2 = await setup();
      await expect(ex.startExtraction(staff, { documentVersionId: s2.guide.version.id, carrierProductId: s2.cp.id })).rejects.toBeInstanceOf(ValidationError);
    } finally {
      process.env.AI_DRIVER = "dev";
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  it("the database requires an applied draft to point at its profile", async () => {
    const s = await setup();
    await expect(db.guideExtraction.create({ data: { documentVersionId: s.guide.version.id, carrierProductId: s.cp.id, status: "APPLIED", model: "x", promptVersion: "x", createdById: staff.userId } })).rejects.toThrow();
    await expect(db.guideExtraction.create({ data: { documentVersionId: s.guide.version.id, carrierProductId: s.cp.id, status: "FAILED", model: "x", promptVersion: "x", createdById: staff.userId } })).rejects.toThrow();
  });
});
