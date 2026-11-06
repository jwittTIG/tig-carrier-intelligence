import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/errors";
import { compareMarkets } from "@/server/services/compare";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";
import { marketChain } from "../support/fixtures";

/** Market comparison (D22) over a fresh, fictional product. */
const db = testPrisma();
let staff: AuthContext;
let chain: Awaited<ReturnType<typeof marketChain>>;
let keyA: string;
let keyB: string;
afterAll(() => db.$disconnect());

async function approvedAppetite(carrierProductId: string, ownerId: string) {
  const p = await db.appetiteProfile.create({
    data: { carrierProductId, version: 1, status: "APPROVED", effectiveFrom: new Date("2025-01-01"), ownerUserId: ownerId, approvedById: ownerId, approvedAt: new Date(), verifiedAt: new Date(), nextReviewAt: new Date("2099-01-01") },
  });
  await db.appetiteRule.create({ data: { profileId: p.id, outcome: "ACCEPTED" } });
}

beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  chain = await marketChain(db);
  const { user, insurer, carrierProduct, channel, appointment, agreement, documentVersion, product } = chain;
  await approvedAppetite(carrierProduct.id, user.id);
  await db.underwritingRequirement.create({ data: { carrierProductId: carrierProduct.id, requirementType: "Loss runs", description: "TEST: 5 years currently valued" } });
  await db.agencyCode.create({ data: { appointmentId: appointment.id, codeType: "MASTER", codeValue: `TEST-${chain.t}`, effectiveFrom: new Date("2026-01-01") } });
  await db.agencyCode.create({ data: { appointmentId: appointment.id, codeType: "SUB_CODE", codeValue: "TEST-ENDED", effectiveFrom: new Date("2020-01-01"), effectiveTo: new Date("2021-01-01") } });
  await db.commissionAgreement.update({ where: { id: agreement.id }, data: { status: "APPROVED", sourceDocumentVersionId: documentVersion.id, approvedById: user.id, approvedAt: new Date() } });
  await db.commissionSchedule.create({
    data: { agreementId: agreement.id, productId: product.id, transactionType: "NEW", basis: "RATE", rate: new Prisma.Decimal("0.125"), effectiveFrom: new Date("2025-01-01"), status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
  });
  // A draft rate must never show.
  await db.commissionSchedule.create({ data: { agreementId: agreement.id, productId: product.id, transactionType: "RENEWAL", basis: "RATE", rate: new Prisma.Decimal("0.2"), effectiveFrom: new Date("2025-01-01") } });

  const other = await db.organization.create({ data: { legalName: `TEST Other ${randomUUID().slice(0, 6)}`, displayName: "TEST Other insurer", type: "INSURER" } });
  const cpB = await db.carrierProduct.create({ data: { writingCompanyId: other.id, productId: product.id } });
  const chB = await db.marketChannel.create({ data: { carrierProductId: cpB.id, distributionType: "DIRECT" } });
  await approvedAppetite(cpB.id, user.id);
  keyA = `${carrierProduct.id}:${channel.id}`;
  keyB = `${cpB.id}:${chB.id}`;
  expect(insurer.id).toBeTruthy();
});

describe("compare markets (D22)", () => {
  it("shows the chosen markets side by side with requirements, codes and the approved commission", async () => {
    const r = await compareMarkets(staff, { productId: chain.product.id, stateCode: "TN", pick: [keyA, keyB] });
    expect(r.disclaimer).toMatch(/not a commitment to quote or bind/);
    expect(r.columns.map((c) => c.key)).toEqual([keyA, keyB]);
    const [a, b] = r.columns;
    expect(a.outcome).toBe("ACCEPTED");
    expect(a.requirements.map((x) => x.requirementType)).toEqual(["Loss runs"]);
    expect(a.codes).toEqual([{ id: expect.any(String), type: "MASTER", value: `TEST-${chain.t}` }]);
    expect(a.commission).toEqual([
      { type: "NEW", text: "12.5%", agreementId: chain.agreement.id },
      { type: "RENEWAL", text: "Rate not recorded", agreementId: null },
    ]);
    expect(a.appointed).toBe(true);
    expect(b.appointed).toBe(false);
    expect(b.requirements).toEqual([]);
    expect(b.codes).toEqual([]);
    expect(b.commission!.every((x) => x.text === "Rate not recorded")).toBe(true);
  });

  it("leaves commission out without commission.read", async () => {
    const limited = await limitedUser(db, ["appetite.read", "appointment.read"]);
    const r = await compareMarkets(limited, { productId: chain.product.id, pick: `${keyA},${keyB}` });
    expect(r.columns.every((c) => c.commission === null)).toBe(true);
    expect(r.columns[0].codes).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("12.5%");
  });

  it("needs 2 to 4 known markets", async () => {
    await expect(compareMarkets(staff, { productId: chain.product.id, pick: [keyA] })).rejects.toBeInstanceOf(ValidationError);
    const five = Array.from({ length: 5 }, () => `${randomUUID()}:none`);
    await expect(compareMarkets(staff, { productId: chain.product.id, pick: five })).rejects.toThrow(/up to 4/);
    await expect(compareMarkets(staff, { productId: chain.product.id, pick: [keyA, "not-a-key"] })).rejects.toThrow(/Unknown market/);
    await expect(compareMarkets(staff, { productId: chain.product.id, pick: [keyA, `${randomUUID()}:none`] })).rejects.toThrow(/no longer matches/);
  });

  it("needs appetite.read", async () => {
    const noAppetite = await limitedUser(db, ["carrier.read"]);
    await expect(compareMarkets(noAppetite, { productId: chain.product.id, pick: [keyA, keyB] })).rejects.toThrow();
  });
});
