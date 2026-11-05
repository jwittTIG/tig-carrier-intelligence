import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import * as app from "@/server/services/appetite";
import { decide, listQueue } from "@/server/services/approvals";
import { addCarrierProduct, createCarrier, listProducts } from "@/server/services/carriers";
import { addSource } from "@/server/services/sources";
import { demoContext, testUser } from "../support/auth";
import { testPrisma } from "../support/db";
import { loadAuthContext } from "@/server/auth/context";

const db = testPrisma();
let staff: AuthContext;
let admin: AuthContext;
let reviewer: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  admin = await demoContext(db, "demo.admin@example.invalid");
  reviewer = (await loadAuthContext((await testUser(db, { role: "STAFF" })).id))!;
});

const t = () => randomUUID().slice(0, 8);
const terr = (code: string) => db.territory.findFirstOrThrow({ where: { stateCode: code, territoryType: "STATE" } });

async function product() {
  const insurer = await createCarrier(staff, { legalName: `TEST Ap ${t()} Co`, displayName: `TEST Ap ${t()}`, type: "INSURER" });
  const p = (await listProducts(staff))[0];
  return addCarrierProduct(staff, insurer.id, { productId: p.id });
}

async function readyDraft(effectiveFrom = "2026-01-01") {
  const cp = await product();
  const profile = await app.createProfile(staff, { carrierProductId: cp.id, effectiveFrom });
  await app.addRule(staff, profile.id, { outcome: "ACCEPTED", territoryIds: [(await terr("TN")).id], industries: "NAICS 238160" });
  await addSource(staff, { recordType: "APPETITE_PROFILE", recordId: profile.id, sourceKind: "USER_ENTERED", sourceNote: "TEST call with underwriter 2026-10-01" });
  return { cp, profile };
}

const crFor = async (id: string) => db.changeRequest.findFirstOrThrow({ where: { recordId: id, status: "PENDING" } });

describe("appetite rules", () => {
  it("records territories, industries and typed attribute values on a draft", async () => {
    const cp = await product();
    const p = await app.createProfile(staff, { carrierProductId: cp.id });
    expect(p.version).toBe(1);
    const def = await app.addAttributeDefinition(staff, cp.productId, { key: `revenue_${t()}`, label: "Annual revenue", dataType: "MONEY", unit: "USD" });
    const r = await app.addRule(staff, p.id, { outcome: "REFERRAL", attributeDefinitionId: def.id, operator: "BETWEEN", value: "$1,000,000 to 5,000,000.50", territoryIds: [(await terr("TN")).id, (await terr("KY")).id] });
    expect(r.typedValue).toEqual({ min: "1000000", max: "5000000.50" });
    expect(r.territories).toHaveLength(2);
    const r2 = await app.addRule(staff, p.id, { outcome: "PROHIBITED", industries: "naics 238160; ISO 91111" });
    expect(r2.industries.map((i) => `${i.classificationSystem}:${i.code}`).sort()).toEqual(["ISO_GL:91111", "NAICS:238160"]);
    await expect(app.addRule(staff, p.id, { outcome: "ACCEPTED", industries: "SIC" })).rejects.toBeInstanceOf(ValidationError);
    await expect(app.addRule(staff, p.id, { outcome: "ACCEPTED", attributeDefinitionId: def.id, operator: "LTE", value: "lots" })).rejects.toBeInstanceOf(ValidationError);
    const unknown = await app.addRule(staff, p.id, { outcome: "UNKNOWN" });
    expect(unknown.outcome).toBe("UNKNOWN");
  });

  it("warns about conflicting rules that could apply to the same risk", async () => {
    const cp = await product();
    const p = await app.createProfile(staff, { carrierProductId: cp.id });
    const tn = (await terr("TN")).id;
    await app.addRule(staff, p.id, { outcome: "ACCEPTED", territoryIds: [tn], industries: "NAICS 238160" });
    await app.addRule(staff, p.id, { outcome: "PROHIBITED", industries: "NAICS 238160" }); // all states → overlaps TN
    await app.addRule(staff, p.id, { outcome: "PROHIBITED", territoryIds: [(await terr("GA")).id], industries: "NAICS 238160" }); // GA only → no overlap with TN rule
    const full = await app.getProfile(staff, p.id);
    // Only TN-accepted vs all-states-prohibited. TN vs GA don't meet; the two PROHIBITED rules agree.
    expect(full.conflicts).toHaveLength(1);
    expect(full.conflicts[0].reason).toMatch(/ACCEPTED and PROHIBITED/);
  });
});

describe("appetite approval (D14)", () => {
  it("submission needs an owner, effective date, a rule and a source", async () => {
    const cp = await product();
    const p = await app.createProfile(staff, { carrierProductId: cp.id });
    await expect(app.submitProfile(staff, p.id, {})).rejects.toThrow(/an effective date, at least one rule, a source/);
  });

  it("the submitter can't approve their own; staff can't with a reason either; an admin can with a reason", async () => {
    const { profile } = await readyDraft();
    await app.submitProfile(staff, profile.id, { note: "TEST" });
    const cr = await crFor(profile.id);
    await expect(decide(staff, cr.id, { decision: "APPROVE", rationale: "I am sure about this one" })).rejects.toBeInstanceOf(ForbiddenError);
    const queue = await listQueue(staff);
    expect(queue.pending.find((q) => q.id === cr.id)?.isOwn).toBe(true);

    const adminDraft = await app.createProfile(admin, { carrierProductId: (await product()).id, effectiveFrom: "2026-01-01" });
    await app.addRule(admin, adminDraft.id, { outcome: "ACCEPTED" });
    await addSource(admin, { recordType: "APPETITE_PROFILE", recordId: adminDraft.id, sourceKind: "USER_ENTERED", sourceNote: "TEST guide" });
    await app.submitProfile(admin, adminDraft.id, {});
    const adminCr = await crFor(adminDraft.id);
    await expect(decide(admin, adminCr.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ValidationError);
    await decide(admin, adminCr.id, { decision: "APPROVE", rationale: "Only admin available this week" });
    expect((await db.appetiteProfile.findUniqueOrThrow({ where: { id: adminDraft.id } })).status).toBe("APPROVED");
  });

  it("approval by someone else: sets approver, review date, verification; locks edits; keeps history", async () => {
    const { cp, profile } = await readyDraft("2026-01-01");
    await app.submitProfile(staff, profile.id, {});
    await expect(app.addRule(staff, profile.id, { outcome: "ACCEPTED" })).rejects.toBeInstanceOf(ConflictError);
    await decide(reviewer, (await crFor(profile.id)).id, { decision: "APPROVE" });
    const v1 = await app.getProfile(staff, profile.id);
    expect(v1.status).toBe("APPROVED");
    expect(v1.approvedById).toBe(reviewer.userId);
    expect(v1.freshness?.state).toBe("FRESH");
    expect(Math.round((v1.nextReviewAt!.getTime() - v1.approvedAt!.getTime()) / 86_400_000)).toBe(365);
    expect(v1.verifications).toHaveLength(1);
    await expect(app.updateProfile(staff, profile.id, { effectiveTo: "2026-12-31" })).rejects.toBeInstanceOf(ConflictError);

    // New version: rules copied, sources not; approving it retires v1 the day before.
    const v2 = await app.newVersion(staff, profile.id);
    expect(v2.version).toBe(2);
    await expect(app.newVersion(staff, profile.id)).rejects.toBeInstanceOf(ConflictError);
    const v2full = await app.getProfile(staff, v2.id);
    expect(v2full.rules).toHaveLength(1);
    expect(v2full.rules[0].industries[0].code).toBe("238160");
    await app.updateProfile(staff, v2.id, { effectiveFrom: "2027-01-01" });
    await expect(app.submitProfile(staff, v2.id, {})).rejects.toThrow(/a source/);
    await addSource(staff, { recordType: "APPETITE_PROFILE", recordId: v2.id, sourceKind: "USER_ENTERED", sourceNote: "TEST 2027 guide" });
    await app.submitProfile(staff, v2.id, {});
    await decide(reviewer, (await crFor(v2.id)).id, { decision: "APPROVE" });
    const old = await db.appetiteProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(old.status).toBe("RETIRED");
    expect(old.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-12-31");
    const versions = (await app.getProfile(staff, v2.id)).versions.map((v) => [v.version, v.status]);
    expect(versions).toEqual([[2, "APPROVED"], [1, "RETIRED"]]);
    expect((await app.listProfilesForCarrier(staff, (await db.carrierProduct.findUniqueOrThrow({ where: { id: cp.id } })).writingCompanyId)).length).toBe(2);
  });

  it("reject needs a reason and returns the draft; withdraw is for the submitter only", async () => {
    const { profile } = await readyDraft();
    await app.submitProfile(staff, profile.id, {});
    const cr = await crFor(profile.id);
    await expect(decide(reviewer, cr.id, { decision: "REJECT" })).rejects.toBeInstanceOf(ValidationError);
    await decide(reviewer, cr.id, { decision: "REJECT", rationale: "Source is out of date" });
    expect((await db.appetiteProfile.findUniqueOrThrow({ where: { id: profile.id } })).status).toBe("DRAFT");
    expect((await db.changeRequest.findUniqueOrThrow({ where: { id: cr.id } })).status).toBe("REJECTED");
    await expect(decide(reviewer, cr.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ConflictError);

    await app.submitProfile(staff, profile.id, {});
    await expect(app.withdrawProfile(reviewer, profile.id)).rejects.toBeInstanceOf(ConflictError);
    await app.withdrawProfile(staff, profile.id);
    expect((await db.appetiteProfile.findUniqueOrThrow({ where: { id: profile.id } })).status).toBe("DRAFT");
  });

  it("only one draft at a time per product; drafts with no review history can be deleted", async () => {
    const cp = await product();
    const p = await app.createProfile(staff, { carrierProductId: cp.id });
    await expect(app.createProfile(staff, { carrierProductId: cp.id })).rejects.toBeInstanceOf(ConflictError);
    await app.deleteDraft(staff, p.id);
    expect(await db.appetiteProfile.count({ where: { id: p.id } })).toBe(0);
  });
});
