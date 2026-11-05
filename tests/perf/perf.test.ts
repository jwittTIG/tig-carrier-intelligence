import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { findMarkets } from "@/server/services/market";
import { globalSearch } from "@/server/services/overview";
import { demoContext } from "../support/auth";
import { testPrisma } from "../support/db";

/**
 * PRD target: p95 search under 2 seconds on a realistic data size. Fictional volume:
 * 300 carriers, each with an approved profile of 8 rules (3 states, 2 NAICS codes each),
 * a coverage limit and a direct channel. Measured on the local test database (PGlite), which
 * is slower than hosted Postgres, so this is a conservative check.
 */
const db = testPrisma();
let staff: AuthContext;
let productId: string;
afterAll(() => db.$disconnect());

const CARRIERS = 300;
const RULES = 8;

beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  const owner = await db.user.findUniqueOrThrow({ where: { email: "demo.admin@example.invalid" } });
  const line = await db.lineOfBusiness.findUniqueOrThrow({ where: { code: "BUILDERS_RISK" } });
  productId = (await db.insuranceProduct.create({ data: { lineId: line.id, code: `TEST_PERF_${randomUUID().slice(0, 6)}`, name: "TEST Perf product" } })).id;
  const states = await db.territory.findMany({ where: { territoryType: "STATE" }, select: { id: true } });
  const naics = ["238160", "238220", "236118", "238210", "2381", "2382"];
  const outcomes = ["PREFERRED", "ACCEPTED", "REFERRAL", "PROHIBITED", "UNKNOWN"] as const;
  const orgs = [], cps = [], chs = [], profiles = [], rules = [], ruleTerr = [], ruleInd = [], covs = [];
  for (let i = 0; i < CARRIERS; i++) {
    const org = randomUUID(), cp = randomUUID(), profile = randomUUID();
    orgs.push({ id: org, legalName: `TEST Perf ${i} Co`, displayName: `TEST Perf ${i}`, type: "INSURER" as const });
    cps.push({ id: cp, writingCompanyId: org, productId });
    chs.push({ carrierProductId: cp, distributionType: "DIRECT" as const });
    covs.push({ carrierProductId: cp, coverageCode: "Each occurrence", maxLimit: String((1 + (i % 5)) * 1_000_000) });
    profiles.push({ id: profile, carrierProductId: cp, version: 1, status: "APPROVED" as const, effectiveFrom: new Date("2025-01-01"), ownerUserId: owner.id, approvedById: owner.id, approvedAt: new Date(), verifiedAt: new Date(), nextReviewAt: new Date("2099-01-01") });
    for (let r = 0; r < RULES; r++) {
      const rule = randomUUID();
      rules.push({ id: rule, profileId: profile, outcome: outcomes[(i + r) % outcomes.length], priority: 100 + r });
      for (let s = 0; s < 3; s++) ruleTerr.push({ ruleId: rule, territoryId: states[(i * 7 + r * 3 + s) % states.length].id });
      for (let k = 0; k < 2; k++) ruleInd.push({ ruleId: rule, classificationSystem: "NAICS" as const, code: naics[(i + r + k) % naics.length] });
    }
  }
  await db.organization.createMany({ data: orgs });
  await db.carrierProduct.createMany({ data: cps });
  await db.marketChannel.createMany({ data: chs });
  await db.coverageCapability.createMany({ data: covs });
  await db.appetiteProfile.createMany({ data: profiles });
  await db.appetiteRule.createMany({ data: rules });
  await db.appetiteRuleTerritory.createMany({ data: ruleTerr });
  await db.appetiteRuleIndustry.createMany({ data: ruleInd });
}, 300_000);

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];

async function time(fn: () => Promise<unknown>, runs = 10) {
  await fn(); // warm-up
  const xs: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    xs.push(performance.now() - t0);
  }
  return { p95: Math.round(p95(xs)), median: Math.round([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]) };
}

describe("search performance", () => {
  it(`Market Finder over ${CARRIERS} carriers / ${CARRIERS * RULES} rules: p95 < 2s`, async () => {
    const r = await findMarkets(staff, { productId, stateCode: "TN", industry: "238160", limit: "2000000" });
    expect(r.total).toBe(CARRIERS);
    const t = await time(() => findMarkets(staff, { productId, stateCode: "TN", industry: "238160", limit: "2000000" }));
    console.log(`[perf] Market Finder: median ${t.median} ms, p95 ${t.p95} ms`);
    expect(t.p95).toBeLessThan(2000);
  }, 120_000);

  it("global search: p95 < 2s", async () => {
    const t = await time(() => globalSearch(staff, "Perf 12"));
    console.log(`[perf] Global search: median ${t.median} ms, p95 ${t.p95} ms`);
    expect(t.p95).toBeLessThan(2000);
  }, 120_000);
});
