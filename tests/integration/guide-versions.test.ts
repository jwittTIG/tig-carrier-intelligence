import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAuthContext, type AuthContext } from "@/server/auth/context";
import { addRule, submitProfile } from "@/server/services/appetite";
import { decide } from "@/server/services/approvals";
import { createCarrier } from "@/server/services/carriers";
import * as docs from "@/server/services/documents";
import * as ex from "@/server/services/extractions";
import { demoContext, limitedUser, testUser } from "../support/auth";
import { testPrisma } from "../support/db";

/** A new version of a guide replaces what the AI drafted from it (N24). Development reader: no real AI calls. */
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

const V1 = [
  "EFFECTIVE: 2026-01-01",
  "STATES: TN",
  "ATTR: roof_covering | Roof covering | ENUM | Asphalt shingle,Metal,Wood shake | p8 | Roof covering of wood shakes",
  "ATTR: roof_age | Roof age | INTEGER |  | p9 | Roofs older than 20 years",
  "RULE: ACCEPTED |  | p3 | Homeowners in Tennessee are eligible.",
  "RULE: PROHIBITED | roof_covering IN Wood shake | p8 | Wood shake roofs are ineligible.",
  "RULE: REFERRAL | roof_age GT 20 | p9 | Roofs older than 20 years refer to underwriting.",
  "LIMIT: Coverage A | 100000 | 1500000 | p5 | Coverage A from $100,000 to $1,500,000",
  "REQ: Deductible | Minimum all-perils deductible is $1,000 | p6",
  "REQ: Required form | Wind/hail endorsement required in coastal counties | p6",
];
const V2 = [
  "EFFECTIVE: 2027-01-01",
  "STATES: TN",
  "ATTR: roof_age | Roof age | INTEGER |  | p9 | Roofs older than 30 years",
  "RULE: ACCEPTED |  | p3 | Homeowners in Tennessee remain eligible.",
  "RULE: PROHIBITED | roof_age GT 30 | p9 | Roofs older than 30 years are ineligible.",
  "LIMIT: Coverage A | 150000 | 2000000 | p5 | Coverage A from $150,000 to $2,000,000",
  "REQ: Deductible | Minimum all-perils deductible is 2,500 dollars | p6",
];
const ALL_V1 = { attributes: ["0", "1"], rules: ["0", "1", "2"], limits: ["0"], requirements: ["0", "1"] };

async function setup() {
  const n = t();
  const carrier = await createCarrier(staff, { legalName: `TEST Versions ${n} Co`, displayName: `TEST Versions ${n}`, type: "INSURER" });
  const line = await db.lineOfBusiness.findUniqueOrThrow({ where: { code: "PERSONAL_HOME" } });
  const product = await db.insuranceProduct.create({ data: { lineId: line.id, code: `TEST_HOV_${n}`, name: `TEST Homeowners ${n}` } });
  const cp = await db.carrierProduct.create({ data: { writingCompanyId: carrier.id, productId: product.id } });
  const guide = await docs.uploadDocument(staff, { title: `TEST HO guide ${n}`, documentType: "UNDERWRITING_GUIDELINES", classification: "INTERNAL", organizationId: carrier.id }, { name: "guide.pdf", bytes: pdf(V1) });
  return { carrier, product, cp, guide };
}
const stateOf = async (documentId: string, documentVersionId: string) => (await ex.guideAppetite(staff, [{ documentId, documentVersionId }])).get(documentId)!;

describe("a new version of a guide replaces what it drafted", () => {
  it("is read in the background for the same product; applying it replaces AI rules, limits and requirements and keeps hand-added rules", async () => {
    const s = await setup();
    const first = await ex.startExtraction(staff, { documentVersionId: s.guide.version.id, carrierProductId: s.cp.id });
    const r1 = await ex.applyExtraction(staff, first.id, ALL_V1);
    expect(r1.added.rules).toBe(3);
    // Someone adds a rule by hand, then v1 is approved.
    const tn = await db.territory.findFirstOrThrow({ where: { territoryType: "STATE", stateCode: "TN" } });
    await addRule(staff, r1.profileId, { outcome: "REFERRAL", territoryIds: [tn.id], rationale: "TEST hand rule: refer risks near the coast" });
    await submitProfile(staff, r1.profileId, {});
    await decide(reviewer, (await db.changeRequest.findFirstOrThrow({ where: { recordId: r1.profileId, status: "PENDING" } })).id, { decision: "APPROVE" });
    expect((await stateOf(s.guide.document.id, s.guide.version.id)).profile).toMatchObject({ version: 1, status: "APPROVED" });

    // v2 is uploaded: a read is queued for the same product, to run after the upload.
    const v2 = await docs.uploadVersion(staff, s.guide.document.id, { name: "guide-v2.pdf", bytes: pdf(V2) });
    const queued = (await ex.queueAutoDraft(staff, v2.id))!;
    expect(queued).toBeTruthy();
    const row = await db.guideExtraction.findUniqueOrThrow({ where: { id: queued } });
    expect([row.status, row.carrierProductId, row.documentVersionId]).toEqual(["RUNNING", s.cp.id, v2.id]);
    const running = await stateOf(s.guide.document.id, v2.id);
    expect([running.current?.status, running.current?.stalled]).toEqual(["RUNNING", false]);
    await expect(ex.applyExtraction(staff, queued, ALL_V1)).rejects.toThrow(/still reading/);

    await ex.runQueuedExtraction(staff, queued);
    await ex.runQueuedExtraction(staff, queued); // a second run does nothing
    expect((await db.guideExtraction.findUniqueOrThrow({ where: { id: queued } })).status).toBe("READY");
    expect(await db.auditEvent.count({ where: { entityId: queued, action: "appetite.extraction.run" } })).toBe(1);

    const r2 = await ex.applyExtraction(staff, queued, { attributes: ["0"], rules: ["0", "1"], limits: ["0"], requirements: ["0"] });
    expect(r2.profileId).not.toBe(r1.profileId);
    expect(r2.replaced).toEqual({ rules: 3, limits: 1, requirements: 2 });
    expect(r2.keptHandRules).toBe(1);
    const p2 = await db.appetiteProfile.findUniqueOrThrow({ where: { id: r2.profileId }, include: { rules: true } });
    expect([p2.version, p2.status]).toEqual([2, "DRAFT"]);
    expect(p2.rules.map((x) => x.rationale ?? "").sort()).toEqual([
      expect.stringMatching(/remain eligible/),
      expect.stringMatching(/older than 30/),
      "TEST hand rule: refer risks near the coast",
    ].sort((a, b) => String(a).localeCompare(String(b))));
    // Every AI rule in the new draft comes from v2.
    const ruleSources = await db.recordSource.findMany({ where: { recordType: "APPETITE_RULE", recordId: { in: p2.rules.map((x) => x.id) }, sourceKind: "AI_EXTRACTED" } });
    expect(ruleSources.map((x) => x.documentVersionId)).toEqual([v2.id, v2.id]);
    // Limits and requirements: only v2's remain.
    expect((await db.coverageCapability.findMany({ where: { carrierProductId: s.cp.id } })).map((c) => Number(c.minLimit))).toEqual([150000]);
    expect((await db.underwritingRequirement.findMany({ where: { carrierProductId: s.cp.id } })).map((q) => q.description)).toEqual([expect.stringMatching(/2,500/)]);
    // The approved v1 stays in use until v2 is approved.
    expect((await db.appetiteProfile.findUniqueOrThrow({ where: { id: r1.profileId } })).status).toBe("APPROVED");
    expect(await db.auditEvent.count({ where: { entityId: r2.profileId, action: "appetite.rule.carry_forward" } })).toBe(1);

    const done = await stateOf(s.guide.document.id, v2.id);
    expect([done.current?.status, done.profile?.version, done.history.length]).toEqual(["APPLIED", 2, 2]);
  });

  it("a newer guide version replaces the earlier version's rules in an open draft", async () => {
    const s = await setup();
    const r1 = await ex.applyExtraction(staff, (await ex.startExtraction(staff, { documentVersionId: s.guide.version.id, carrierProductId: s.cp.id })).id, ALL_V1);
    const v2 = await docs.uploadVersion(staff, s.guide.document.id, { name: "guide-v2.pdf", bytes: pdf(V2) });
    const run = await ex.startExtraction(staff, { documentVersionId: v2.id, carrierProductId: s.cp.id });
    const r2 = await ex.applyExtraction(staff, run.id, { attributes: ["0"], rules: ["0", "1"], limits: [], requirements: [] });
    expect(r2.profileId).toBe(r1.profileId);
    expect(r2.replaced).toEqual({ rules: 3, limits: 0, requirements: 0 }); // no new limits ticked: the old ones stay
    expect(await db.appetiteRule.count({ where: { profileId: r1.profileId } })).toBe(2);
    expect(await db.coverageCapability.count({ where: { carrierProductId: s.cp.id } })).toBe(1);
  });

  it("queues nothing for a guide never drafted, without appetite.write, with AI off, or once restricted; a read that never finishes shows as stopped", async () => {
    const s = await setup();
    const v2 = await docs.uploadVersion(staff, s.guide.document.id, { name: "guide-v2.pdf", bytes: pdf(V2) });
    expect(await ex.queueAutoDraft(staff, v2.id)).toBeNull(); // never drafted: a person picks the product first

    await ex.startExtraction(staff, { documentVersionId: v2.id, carrierProductId: s.cp.id });
    const v3 = await docs.uploadVersion(staff, s.guide.document.id, { name: "guide-v3.pdf", bytes: pdf(V2) });
    const reader = await limitedUser(db, ["appetite.read", "document.read", "document.write"]);
    expect(await ex.queueAutoDraft(reader, v3.id)).toBeNull();
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_DRIVER = "";
    try {
      expect(await ex.queueAutoDraft(staff, v3.id)).toBeNull();
    } finally {
      process.env.AI_DRIVER = "dev";
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
    // Not read (AI was off): the page offers "Update appetite from v3" for the same product.
    const unread = await stateOf(s.guide.document.id, v3.id);
    expect(unread.current).toBeNull();
    expect(unread.earlier?.carrierProductId).toBe(s.cp.id);

    const id = (await ex.queueAutoDraft(staff, v3.id))!;
    await db.guideExtraction.update({ where: { id }, data: { createdAt: new Date(Date.now() - ex.RUNNING_TIMEOUT_MS - 60_000) } });
    expect((await stateOf(s.guide.document.id, v3.id)).current?.stalled).toBe(true);

    await db.document.update({ where: { id: s.guide.document.id }, data: { classification: "RESTRICTED" } });
    const v4 = await docs.uploadVersion(staff, s.guide.document.id, { name: "guide-v4.pdf", bytes: pdf(V2) });
    expect(await ex.queueAutoDraft(staff, v4.id)).toBeNull(); // restricted documents never go to the AI
  });
});
