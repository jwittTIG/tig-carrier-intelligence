import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/errors";
import { findMarkets } from "@/server/services/market";
import { demoContext } from "../support/auth";
import { testPrisma } from "../support/db";

/**
 * Market Finder over a product created just for this file, so other tests can't affect it.
 * "TN roofing contractor, $2M GL" style questions.
 */
const db = testPrisma();
let staff: AuthContext;
let productId: string;
const ids: Record<string, string> = {};
afterAll(() => db.$disconnect());

const t = () => randomUUID().slice(0, 6);
const state = (code: string) => db.territory.findFirstOrThrow({ where: { stateCode: code, territoryType: "STATE" } });

async function market(name: string, o: {
  rules?: { outcome: "PREFERRED" | "ACCEPTED" | "REFERRAL" | "PROHIBITED" | "UNKNOWN"; states?: string[]; naics?: string[]; priority?: number; attribute?: boolean }[];
  status?: "APPROVED" | "DRAFT";
  maxLimit?: string | null;
  appointed?: boolean;
  stale?: boolean;
} = {}) {
  const user = await db.user.findUniqueOrThrow({ where: { email: "demo.admin@example.invalid" } });
  const org = await db.organization.create({ data: { legalName: `TEST MF ${name} ${t()}`, displayName: `TEST MF ${name}`, type: "INSURER" } });
  const cp = await db.carrierProduct.create({ data: { writingCompanyId: org.id, productId } });
  const ch = await db.marketChannel.create({ data: { carrierProductId: cp.id, distributionType: "DIRECT" } });
  if (o.maxLimit) await db.coverageCapability.create({ data: { carrierProductId: cp.id, coverageCode: "GL each occurrence", maxLimit: new Prisma.Decimal(o.maxLimit) } });
  if (o.appointed) {
    const entity = await db.agencyEntity.findFirstOrThrow();
    await db.agencyAppointment.create({ data: { agencyEntityId: entity.id, marketChannelId: ch.id, appointmentType: "Direct", status: "ACTIVE", effectiveFrom: new Date("2025-01-01") } });
  }
  if (o.rules) {
    const approved = (o.status ?? "APPROVED") === "APPROVED";
    const profile = await db.appetiteProfile.create({
      data: {
        carrierProductId: cp.id, version: 1, status: o.status ?? "APPROVED", effectiveFrom: new Date("2025-01-01"), ownerUserId: user.id,
        ...(approved && { approvedById: user.id, approvedAt: new Date(), verifiedAt: new Date(), nextReviewAt: o.stale ? new Date("2026-01-01") : new Date("2099-01-01") }),
      },
    });
    const attr = await db.riskAttributeDefinition.upsert({ where: { productId_key: { productId, key: "annual_revenue" } }, update: {}, create: { productId, key: "annual_revenue", label: "Annual revenue", dataType: "MONEY", unit: "USD" } });
    for (const r of o.rules) {
      const territories = await Promise.all((r.states ?? []).map(state));
      await db.appetiteRule.create({
        data: {
          profileId: profile.id, outcome: r.outcome, priority: r.priority ?? 100,
          ...(r.attribute && { attributeDefinitionId: attr.id, operator: "LTE", typedValue: { value: "5000000" } }),
          territories: { create: territories.map((x) => ({ territoryId: x.id })) },
          industries: { create: (r.naics ?? []).map((code) => ({ classificationSystem: "NAICS" as const, code })) },
        },
      });
    }
  }
  ids[name] = org.id;
  return org;
}

beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  const line = await db.lineOfBusiness.findUniqueOrThrow({ where: { code: "ENVIRONMENTAL" } });
  productId = (await db.insuranceProduct.create({ data: { lineId: line.id, code: `TEST_MF_${t()}`, name: "TEST Market Finder product" } })).id;
  await market("RoofersWelcome", { rules: [{ outcome: "ACCEPTED", states: ["TN"], naics: ["238160"] }], maxLimit: "2000000", appointed: true });
  await market("PrefixMatch", { rules: [{ outcome: "PREFERRED", naics: ["2381"] }], maxLimit: "5000000" });
  await market("NoRoofers", { rules: [{ outcome: "ACCEPTED" }, { outcome: "PROHIBITED", naics: ["238160"], priority: 10 }] });
  await market("KentuckyOnly", { rules: [{ outcome: "ACCEPTED", states: ["KY"], naics: ["238160"] }] });
  await market("NoProfile", { maxLimit: "1000000" });
  await market("DraftOnly", { rules: [{ outcome: "ACCEPTED" }], status: "DRAFT" });
  await market("LowLimit", { rules: [{ outcome: "REFERRAL", states: ["TN"] }], maxLimit: "1000000" });
  await market("Conflicted", { rules: [{ outcome: "ACCEPTED", states: ["TN"] }, { outcome: "REFERRAL", naics: ["238160"] }, { outcome: "PROHIBITED", attribute: true }], stale: true });
});

const find = (extra: Record<string, string> = {}) => findMarkets(staff, { productId, stateCode: "TN", industry: "238160", limit: "2,000,000", ...extra });
const groupOf = (r: Awaited<ReturnType<typeof find>>, name: string) => r.groups.find((g) => g.results.some((x) => x.carrier.id === ids[name]))?.outcome;
const resultFor = (r: Awaited<ReturnType<typeof find>>, name: string) => r.groups.flatMap((g) => g.results).find((x) => x.carrier.id === ids[name])!;

describe("Market Finder: TN roofing contractor, $2M", () => {
  it("groups carriers by stated outcome, and unknown is never eligible", async () => {
    const r = await find();
    expect(groupOf(r, "RoofersWelcome")).toBe("ACCEPTED");
    expect(groupOf(r, "PrefixMatch")).toBe("PREFERRED"); // NAICS 2381 covers 238160
    expect(groupOf(r, "NoRoofers")).toBe("PROHIBITED"); // class rule outranks the general one
    expect(groupOf(r, "KentuckyOnly")).toBe("UNKNOWN");
    expect(groupOf(r, "NoProfile")).toBe("UNKNOWN");
    expect(groupOf(r, "DraftOnly")).toBe("UNKNOWN"); // drafts are ignored
    expect(resultFor(r, "NoProfile").note).toBe("No approved appetite recorded");
    expect(resultFor(r, "KentuckyOnly").note).toMatch(/nothing stated for this class\/state/);
    expect(r.disclaimer).toMatch(/not a commitment to quote or bind/);
  });

  it("compares the limit with stated maximums; blank is 'not stated', never 'no limit'", async () => {
    const r = await find();
    expect(resultFor(r, "RoofersWelcome").limit.state).toBe("OK");
    expect(resultFor(r, "LowLimit").limit.state).toBe("BELOW");
    expect(resultFor(r, "NoRoofers").limit.state).toBe("NOT_STATED");
  });

  it("shows appointment, staleness, conflicts and conditions to check by hand", async () => {
    const r = await find();
    expect(resultFor(r, "RoofersWelcome").appointed).toBe(true);
    expect(resultFor(r, "PrefixMatch").appointed).toBe(false);
    const c = resultFor(r, "Conflicted");
    expect(c.stale).toBe(true);
    expect(c.conflicting).toBe(true);
    expect(c.conditions).toEqual([{ label: "Annual revenue", outcome: "PROHIBITED", text: "Annual revenue ≤ 5000000 USD" }]);
  });

  it("without an industry, class-specific rules don't count", async () => {
    const r = await findMarkets(staff, { productId, stateCode: "TN" });
    expect(groupOf(r, "RoofersWelcome")).toBe("UNKNOWN");
    expect(groupOf(r, "NoRoofers")).toBe("ACCEPTED");
    expect(groupOf(r, "LowLimit")).toBe("REFERRAL");
  });

  it("requires a line or product and a valid industry code", async () => {
    await expect(findMarkets(staff, { stateCode: "TN" })).rejects.toBeInstanceOf(ValidationError);
    await expect(findMarkets(staff, { productId, industry: "roofing" })).rejects.toBeInstanceOf(ValidationError);
  });
});
