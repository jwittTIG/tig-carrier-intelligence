/**
 * Seed: reference data (P&C line taxonomy, US territories, roles/permissions, settings)
 * plus a small set of clearly fictional DEMO records.
 *
 * Nothing here is real TIG data. DEMO organizations, people, codes and rates are
 * invented, prefixed "DEMO", and must never be mistaken for actual carrier terms.
 * Safe to run repeatedly: reference data is upserted; DEMO data is created once.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { parseCsv } from "../src/lib/csv";
import { assertPropertyCasualtyLine } from "../src/lib/taxonomy/scope";
import { PERMISSIONS, ROLES } from "../src/server/auth/catalog";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// ── P&C line taxonomy (PRD "Scope") ──
type LineSeed = { code: string; name: string; parent?: string };
export const LINES: LineSeed[] = [
  { code: "COMMERCIAL_PROPERTY", name: "Commercial Property" },
  { code: "HABITATIONAL", name: "Habitational", parent: "COMMERCIAL_PROPERTY" },
  { code: "GENERAL_LIABILITY", name: "General Liability" },
  { code: "BOP", name: "Businessowners (BOP)" },
  { code: "WORKERS_COMP", name: "Workers' Compensation" },
  { code: "COMMERCIAL_AUTO", name: "Commercial Auto" },
  { code: "UMBRELLA_EXCESS", name: "Umbrella / Excess" },
  { code: "PROFESSIONAL_EO", name: "Professional Liability / E&O" },
  { code: "DO", name: "Directors & Officers (D&O)" },
  { code: "EPLI", name: "Employment Practices Liability (EPLI)" },
  { code: "CYBER", name: "Cyber" },
  { code: "ENVIRONMENTAL", name: "Environmental / Pollution" },
  { code: "INLAND_MARINE", name: "Inland Marine" },
  { code: "BUILDERS_RISK", name: "Builders Risk", parent: "INLAND_MARINE" },
  { code: "CRIME", name: "Crime / Fidelity" },
  { code: "PERSONAL_HOME", name: "Personal Homeowners" },
  { code: "PERSONAL_AUTO", name: "Personal Auto" },
  { code: "PERSONAL_UMBRELLA", name: "Personal Umbrella" },
  { code: "FLOOD", name: "Flood" },
  { code: "SPECIALTY_OTHER", name: "Specialty / Other P&C" },
  { code: "SURETY", name: "Surety / Bonds" },
  { code: "SURETY_CONTRACT", name: "Contract Surety", parent: "SURETY" },
  { code: "SURETY_COMMERCIAL", name: "Commercial Surety", parent: "SURETY" },
];

// ── US states + DC (public reference data) ──
export const STATES: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

// Permissions and roles come from the shared catalog (DECISIONS D1).

export const SETTINGS: Record<string, Prisma.InputJsonValue> = {
  "appetite.review_cadence_days": 365,
  "contact.review_cadence_days": 365,
  "document.max_upload_mb": 25,
  "inbox.stale_days": 7,
  "search.disclaimer":
    "Appetite information is a guide, not a commitment to quote or bind. Confirm eligibility with the underwriter.",
};

async function seedReference() {
  for (const line of LINES) assertPropertyCasualtyLine(line.name);
  const lineIds = new Map<string, string>();
  for (const [i, line] of LINES.entries()) {
    const parentId = line.parent ? lineIds.get(line.parent) : null;
    const row = await prisma.lineOfBusiness.upsert({
      where: { code: line.code },
      update: { name: line.name, parentId, sortOrder: i * 10 },
      create: { code: line.code, name: line.name, parentId, sortOrder: i * 10 },
    });
    lineIds.set(line.code, row.id);
  }

  const us = await prisma.territory.findFirst({ where: { countryCode: "US", territoryType: "COUNTRY" } });
  if (!us) await prisma.territory.create({ data: { countryCode: "US", territoryType: "COUNTRY", name: "United States" } });
  for (const [code, name] of STATES) {
    const existing = await prisma.territory.findFirst({ where: { countryCode: "US", stateCode: code, territoryType: "STATE" } });
    if (!existing) await prisma.territory.create({ data: { countryCode: "US", stateCode: code, territoryType: "STATE", name } });
  }

  for (const { code, description } of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
  }
  const perms = await prisma.permission.findMany();
  for (const role of ROLES) {
    const r = await prisma.role.upsert({ where: { code: role.code }, update: { description: role.description }, create: { code: role.code, description: role.description } });
    const wanted = new Set<string>(role.permissions);
    await prisma.rolePermission.createMany({
      data: perms.filter((p) => wanted.has(p.code)).map((p) => ({ roleId: r.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.appSetting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // NAICS 2022 titles from the U.S. Census Bureau (public data, not TIG data), for word search
  // in the Market Finder. Sectors like "31-33" are stored as written. Regenerate the CSV with
  // scripts/naics-to-csv.mjs when Census publishes a new edition.
  const [header, ...rows] = parseCsv(fs.readFileSync(path.join(import.meta.dirname, "data", "naics-2022.csv"), "utf8"));
  if (header?.join(",") !== "code,title") throw new Error("prisma/data/naics-2022.csv: unexpected header");
  await prisma.industryCode.createMany({
    data: rows.filter((r) => r[0] && r[1]).map(([code, title]) => ({ classificationSystem: "NAICS" as const, code, title, level: code.replace(/-\d+$/, "").length, sourceVersion: "NAICS 2022" })),
    skipDuplicates: true,
  });

  // Non-login system user that "uploads" files taken in from the mailbox (Milestone 6).
  // DEACTIVATED and without roles, so it can never sign in or act.
  await prisma.user.upsert({
    where: { email: "mail-intake@system.invalid" },
    update: { status: "DEACTIVATED" },
    create: { name: "System (mail intake)", email: "mail-intake@system.invalid", status: "DEACTIVATED" },
  });
}

/** Fictional records so screens and tests have something to show. All prefixed DEMO. */
async function seedDemo() {
  if (await prisma.organization.findFirst({ where: { displayName: { startsWith: "DEMO " } } })) return;

  await prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({ data: { name: "DEMO Admin", email: "demo.admin@example.invalid", status: "ACTIVE" } });
    const staff = await tx.user.create({ data: { name: "DEMO Producer", email: "demo.producer@example.invalid", status: "ACTIVE" } });
    const roles = await tx.role.findMany();
    const role = (code: string) => roles.find((r) => r.code === code)!.id;
    await tx.userRoleScope.createMany({ data: [{ userId: admin.id, roleId: role("ADMIN") }, { userId: staff.id, roleId: role("STAFF") }] });

    const agencyOrg = await tx.organization.create({ data: { legalName: "DEMO Agency Entity LLC", displayName: "DEMO Agency Entity", type: "AGENCY" } });
    const agency = await tx.agencyEntity.create({ data: { organizationId: agencyOrg.id, domicileState: "TN" } });

    const group = await tx.organization.create({ data: { legalName: "DEMO Summit Mutual Group", displayName: "DEMO Summit Mutual Group", type: "GROUP", ownerUserId: admin.id } });
    const summit = await tx.organization.create({ data: { legalName: "DEMO Summit Mutual Insurance Company", displayName: "DEMO Summit Mutual", type: "INSURER", parentId: group.id, ownerUserId: admin.id } });
    const ridgeline = await tx.organization.create({ data: { legalName: "DEMO Ridgeline Specialty Insurance Company", displayName: "DEMO Ridgeline Specialty", type: "INSURER", ownerUserId: admin.id } });
    const wholesaler = await tx.organization.create({ data: { legalName: "DEMO Bluff City Wholesale Brokers LLC", displayName: "DEMO Bluff City Wholesale", type: "WHOLESALER" } });
    await tx.organizationRelationship.createMany({
      data: [
        { fromOrgId: summit.id, toOrgId: group.id, relationshipType: "GROUP_MEMBER" },
        { fromOrgId: wholesaler.id, toOrgId: ridgeline.id, relationshipType: "WHOLESALER_FOR" },
      ],
    });

    const gl = await tx.lineOfBusiness.findUniqueOrThrow({ where: { code: "GENERAL_LIABILITY" } });
    const product = await tx.insuranceProduct.create({ data: { lineId: gl.id, code: "DEMO_CONTRACTORS_GL", name: "DEMO Contractors General Liability", productType: "MONOLINE" } });
    // One product, two writing companies, two channels (direct and via wholesaler).
    const summitGl = await tx.carrierProduct.create({ data: { writingCompanyId: summit.id, productId: product.id } });
    const ridgelineGl = await tx.carrierProduct.create({ data: { writingCompanyId: ridgeline.id, productId: product.id, programName: "DEMO E&S Contractors" } });
    const direct = await tx.marketChannel.create({ data: { carrierProductId: summitGl.id, distributionType: "DIRECT", accessStatus: "AVAILABLE" } });
    await tx.marketChannel.create({ data: { carrierProductId: ridgelineGl.id, intermediaryOrgId: wholesaler.id, distributionType: "WHOLESALE", accessStatus: "AVAILABLE" } });

    const appointment = await tx.agencyAppointment.create({
      data: { agencyEntityId: agency.id, marketChannelId: direct.id, appointmentType: "DIRECT", status: "ACTIVE", effectiveFrom: new Date("2026-01-01") },
    });
    await tx.agencyCode.create({
      data: { appointmentId: appointment.id, codeType: "MASTER", codeValue: "DEMO-0001", effectiveFrom: new Date("2026-01-01"), notes: "DEMO code — not real" },
    });
    await tx.carrierPortal.create({
      data: { organizationId: summit.id, name: "DEMO Summit agent portal", url: "https://portal.example.invalid/", credentialVaultReference: "Password manager: DEMO / Summit" },
    });

    const tn = await tx.territory.findFirstOrThrow({ where: { stateCode: "TN", territoryType: "STATE" } });
    const ky = await tx.territory.findFirstOrThrow({ where: { stateCode: "KY", territoryType: "STATE" } });
    const contact = await tx.contact.create({ data: { firstName: "Demo", lastName: "Underwriter", email: "demo.uw@example.invalid" } });
    await tx.contactAssignment.createMany({
      data: [
        { contactId: contact.id, organizationId: summit.id, marketChannelId: direct.id, territoryId: tn.id, role: "UNDERWRITER", title: "DEMO Senior Underwriter" },
        { contactId: contact.id, organizationId: summit.id, marketChannelId: direct.id, territoryId: ky.id, role: "UNDERWRITER", title: "DEMO Senior Underwriter" },
      ],
    });

    // Draft only: an unapproved appetite statement with no source yet.
    const profile = await tx.appetiteProfile.create({ data: { carrierProductId: summitGl.id, marketChannelId: direct.id, version: 1, status: "DRAFT", ownerUserId: admin.id } });
    const rule = await tx.appetiteRule.create({ data: { profileId: profile.id, outcome: "REFERRAL", rationale: "DEMO rule — illustrative only" } });
    await tx.appetiteRuleTerritory.create({ data: { ruleId: rule.id, territoryId: tn.id } });
    await tx.appetiteRuleIndustry.create({ data: { ruleId: rule.id, classificationSystem: "NAICS", code: "238160" } });

    const agreement = await tx.commissionAgreement.create({ data: { agencyEntityId: agency.id, marketChannelId: direct.id, status: "DRAFT", agreementRef: "DEMO-AGREEMENT", notes: "DEMO — illustrative, not real terms" } });
    await tx.commissionSchedule.create({
      data: { agreementId: agreement.id, productId: product.id, transactionType: "NEW", basis: "RATE", rate: new Prisma.Decimal("0.100000"), effectiveFrom: new Date("2026-01-01"), status: "DRAFT", notes: "DEMO rate — not a real commission rate" },
    });

    await tx.auditEvent.create({ data: { action: "seed.demo", entityType: "seed", afterState: { note: "DEMO records created by prisma/seed.ts" } } });
  });
}

async function main() {
  await seedReference();
  // DEMO records only when asked for (the test databases). The dev and production databases hold real data.
  if (process.env.SEED_DEMO === "1") await seedDemo();
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
