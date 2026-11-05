import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAuthContext, type AuthContext } from "@/server/auth/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { listAgencyEntities } from "@/server/services/appointments";
import { decide } from "@/server/services/approvals";
import { addCarrierProduct, addChannel, createCarrier, getCarrier, listProducts } from "@/server/services/carriers";
import * as com from "@/server/services/commissions";
import { uploadDocument } from "@/server/services/documents";
import { demoContext, limitedUser, testUser } from "../support/auth";
import { testPrisma } from "../support/db";

const db = testPrisma();
let staff: AuthContext;
let reviewer: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  reviewer = (await loadAuthContext((await testUser(db, { role: "STAFF" })).id))!;
});

const t = () => randomUUID().slice(0, 8);
const pdf = () => new TextEncoder().encode(`%PDF-1.4\n% TEST agreement ${Math.random()}\n%%EOF\n`);
const crFor = (id: string) => db.changeRequest.findFirstOrThrow({ where: { recordId: id, status: "PENDING" } });

async function approvedAgreement() {
  const insurer = await createCarrier(staff, { legalName: `TEST Cm ${t()} Co`, displayName: `TEST Cm ${t()}`, type: "INSURER" });
  const product = (await listProducts(staff))[0];
  const cp = await addCarrierProduct(staff, insurer.id, { productId: product.id });
  const ch = await addChannel(staff, insurer.id, cp.id, { distributionType: "DIRECT" });
  const entity = (await listAgencyEntities(staff))[0];
  const doc = await uploadDocument(staff, { title: "TEST Agency agreement", documentType: "AGREEMENT", classification: "RESTRICTED" }, { name: "agreement.pdf", bytes: pdf() });
  const a = await com.createAgreement(staff, { agencyEntityId: entity.id, marketChannelId: ch.id, agreementRef: `TEST-${t()}`, sourceDocumentVersionId: doc.version.id, contingencyNotes: "TEST: profit share on loss ratio under 50%" });
  await com.submitAgreement(staff, a.id, {});
  await decide(reviewer, (await crFor(a.id)).id, { decision: "APPROVE" });
  return { insurer, product, agreement: a };
}

async function approve(agreementId: string, input: Record<string, unknown>) {
  const s = await com.addSchedule(staff, agreementId, input);
  await com.submitSchedule(staff, agreementId, s.id, {});
  await decide(reviewer, (await crFor(s.id)).id, { decision: "APPROVE" });
  return s;
}

describe("rates", () => {
  it("converts percentages exactly, with no floating point", () => {
    expect(com.percentToFraction("12.5").toString()).toBe("0.125");
    expect(com.percentToFraction("0.1%").toString()).toBe("0.001");
    expect(com.percentToFraction("15.0125").toString()).toBe("0.150125");
    expect(com.fractionToPercent(com.percentToFraction("12.5"))).toBe("12.5%");
    expect(() => com.percentToFraction("101")).toThrow(ValidationError);
    expect(() => com.percentToFraction("12.34567")).toThrow(ValidationError);
    expect(() => com.percentToFraction("abc")).toThrow(ValidationError);
  });
});

describe("agreements", () => {
  it("can't be submitted without the agreement document; schedules need an approved agreement", async () => {
    const { product } = await approvedAgreement();
    const draftAg = await com.createAgreement(staff, { agencyEntityId: (await listAgencyEntities(staff))[0].id, marketChannelId: (await db.marketChannel.findFirstOrThrow()).id });
    await expect(com.submitAgreement(staff, draftAg.id, {})).rejects.toThrow(/Attach the signed agreement/);
    const s = await com.addSchedule(staff, draftAg.id, { productId: product.id, transactionType: "NEW", basis: "RATE", ratePercent: "10", effectiveFrom: "2026-01-01" });
    await expect(com.submitSchedule(staff, draftAg.id, s.id, {})).rejects.toThrow(/Attach the agreement document/);
  });

  it("keeps contingency notes editable but locks the reference after approval", async () => {
    const { agreement } = await approvedAgreement();
    await com.updateAgreement(staff, agreement.id, { contingencyNotes: "TEST: updated 2027 terms" });
    await expect(com.updateAgreement(staff, agreement.id, { agreementRef: "CHANGED" })).rejects.toBeInstanceOf(ConflictError);
    expect((await db.commissionAgreement.findUniqueOrThrow({ where: { id: agreement.id } })).contingencyNotes).toBe("TEST: updated 2027 terms");
  });
});

describe("schedules", () => {
  it("rates vary by new/renewal; approving a new rate ends the old one the day before", async () => {
    const { agreement, product } = await approvedAgreement();
    const oldNew = await approve(agreement.id, { productId: product.id, transactionType: "NEW", basis: "RATE", ratePercent: "15", effectiveFrom: "2025-01-01" });
    await approve(agreement.id, { productId: product.id, transactionType: "RENEWAL", basis: "RATE", ratePercent: "12.5", effectiveFrom: "2025-01-01" });
    const newNew = await approve(agreement.id, { productId: product.id, transactionType: "NEW", basis: "RATE", ratePercent: "14", effectiveFrom: "2027-01-01" });
    const old = await db.commissionSchedule.findUniqueOrThrow({ where: { id: oldNew.id } });
    expect(old.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(old.status).toBe("APPROVED"); // history kept, now ended
    const full = await com.getAgreement(staff, agreement.id);
    const approved = full.schedules.filter((s) => s.status === "APPROVED").map((s) => [s.transactionType, com.fractionToPercent(s.rate)]);
    expect(approved).toEqual(expect.arrayContaining([["NEW", "15%"], ["NEW", "14%"], ["RENEWAL", "12.5%"]]));
    expect(full.schedules.find((s) => s.id === newNew.id)?.current).toBe(false); // starts 2027
    expect(await db.auditEvent.count({ where: { entityId: oldNew.id, action: "commission.schedule.superseded" } })).toBe(1);
  });

  it("refuses to approve a schedule that overlaps a later approved one", async () => {
    const { agreement, product } = await approvedAgreement();
    await approve(agreement.id, { productId: product.id, transactionType: "NEW", basis: "RATE", ratePercent: "15", effectiveFrom: "2027-01-01" });
    const earlier = await com.addSchedule(staff, agreement.id, { productId: product.id, transactionType: "NEW", basis: "RATE", ratePercent: "16", effectiveFrom: "2026-01-01" });
    await com.submitSchedule(staff, agreement.id, earlier.id, {});
    await expect(decide(reviewer, (await crFor(earlier.id)).id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ConflictError);
    expect((await db.commissionSchedule.findUniqueOrThrow({ where: { id: earlier.id } })).status).toBe("PENDING");
  });

  it("tiered schedules need tiers; approved schedules are locked; self-approval refused", async () => {
    const { agreement, product } = await approvedAgreement();
    const tiered = await com.addSchedule(staff, agreement.id, { productId: product.id, transactionType: "OTHER", basis: "TIERED", effectiveFrom: "2026-01-01" });
    await expect(com.submitSchedule(staff, agreement.id, tiered.id, {})).rejects.toThrow(/at least one tier/);
    await com.addTier(staff, agreement.id, tiered.id, { thresholdMin: "0", thresholdMax: "$100,000", ratePercent: "10" });
    await com.addTier(staff, agreement.id, tiered.id, { thresholdMin: "100000.01", ratePercent: "12" });
    await com.submitSchedule(staff, agreement.id, tiered.id, {});
    await expect(decide(staff, (await crFor(tiered.id)).id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
    await decide(reviewer, (await crFor(tiered.id)).id, { decision: "APPROVE" });
    await expect(com.addTier(staff, agreement.id, tiered.id, { thresholdMin: "1", ratePercent: "1" })).rejects.toBeInstanceOf(ConflictError);
    await expect(com.deleteDraftSchedule(staff, agreement.id, tiered.id)).rejects.toBeInstanceOf(ConflictError);
    await com.retireSchedule(staff, agreement.id, tiered.id, { reason: "TEST program closed", effectiveTo: "2026-06-30" });
    expect((await db.commissionSchedule.findUniqueOrThrow({ where: { id: tiered.id } })).status).toBe("RETIRED");
  });

  it("all commission data needs commission.read; carrier responses carry none", async () => {
    const { agreement, insurer } = await approvedAgreement();
    const noComm = await limitedUser(db, ["carrier.read", "document.read"]);
    await expect(com.getAgreement(noComm, agreement.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(com.listAgreementsForCarrier(noComm, insurer.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(com.schedulesCsv(noComm)).rejects.toBeInstanceOf(ForbiddenError);
    expect(JSON.stringify(await getCarrier(noComm, insurer.id))).not.toMatch(/commission|agreement|rate/i);
  });

  it("exports schedules as CSV", async () => {
    const { agreement, product } = await approvedAgreement();
    await approve(agreement.id, { productId: product.id, transactionType: "NEW", basis: "RATE", ratePercent: "12.5", effectiveFrom: "2026-01-01", notes: "=SUM(A1)" });
    const csv = await com.schedulesCsv(staff, agreement.id);
    expect(csv).toContain('"12.5%"');
    expect(csv).toContain(`"'=SUM(A1)"`);
  });
});
