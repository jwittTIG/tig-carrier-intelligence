/**
 * Milestone 1: database-level rules from docs/DATA_MODEL.md "Constraints & indexes"
 * and docs/ACCEPTANCE_TESTS.md. Each test builds its own fictional fixtures.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { PG, pgErrorCode, testPg, testPrisma } from "../support/db";
import { marketChain } from "../support/fixtures";

const db = testPrisma();
let sql: pg.Client;

beforeAll(async () => {
  sql = await testPg();
});
afterAll(async () => {
  await sql.end();
  await db.$disconnect();
});

const insertSchedule = (
  c: Awaited<ReturnType<typeof marketChain>>,
  o: { from: string; to?: string | null; type?: string; status?: string; territoryId?: string | null; rate?: string; basis?: string },
) =>
  pgErrorCode(
    sql,
    `insert into commission_schedules (agreement_id, product_id, territory_id, transaction_type, basis, rate, effective_from, effective_to, status, approved_by, approved_at)
     values ($1, $2, $3, $4::"TransactionType", $5::"CommissionBasis", $6, $7, $8, $9::"ApprovalStatus", $10, $11)`,
    [
      c.agreement.id, c.product.id, o.territoryId ?? null, o.type ?? "NEW", o.basis ?? "RATE", o.rate ?? "0.125",
      o.from, o.to ?? null, o.status ?? "APPROVED",
      (o.status ?? "APPROVED") === "APPROVED" ? c.user.id : null,
      (o.status ?? "APPROVED") === "APPROVED" ? new Date() : null,
    ],
  );

describe("commission schedules", () => {
  it("rejects overlapping APPROVED schedules with identical scope", async () => {
    const c = await marketChain(db);
    expect(await insertSchedule(c, { from: "2026-01-01", to: "2026-12-31" })).toBeNull();
    expect(await insertSchedule(c, { from: "2026-06-01" })).toBe(PG.EXCLUSION_VIOLATION);
  });

  it("allows back-to-back periods, other transaction types, and drafts", async () => {
    const c = await marketChain(db);
    expect(await insertSchedule(c, { from: "2026-01-01", to: "2026-12-31" })).toBeNull();
    expect(await insertSchedule(c, { from: "2027-01-01" })).toBeNull();
    expect(await insertSchedule(c, { from: "2026-01-01", type: "RENEWAL", rate: "0.10" })).toBeNull();
    expect(await insertSchedule(c, { from: "2026-03-01", status: "DRAFT" })).toBeNull();
  });

  it("treats a null territory as one scope (two all-territory schedules collide)", async () => {
    const c = await marketChain(db);
    expect(await insertSchedule(c, { from: "2026-01-01", territoryId: null })).toBeNull();
    expect(await insertSchedule(c, { from: "2026-02-01", territoryId: null })).toBe(PG.EXCLUSION_VIOLATION);
    const tn = await db.territory.findFirstOrThrow({ where: { stateCode: "TN" } });
    expect(await insertSchedule(c, { from: "2026-02-01", territoryId: tn.id })).toBeNull();
  });

  it("rates vary by new/renewal, product, territory and effective date", async () => {
    const c = await marketChain(db);
    const ky = await db.territory.findFirstOrThrow({ where: { stateCode: "KY" } });
    expect(await insertSchedule(c, { from: "2026-01-01", to: "2026-12-31", rate: "0.15" })).toBeNull();
    expect(await insertSchedule(c, { from: "2026-01-01", type: "RENEWAL", rate: "0.12" })).toBeNull();
    expect(await insertSchedule(c, { from: "2026-01-01", territoryId: ky.id, rate: "0.14" })).toBeNull();
    expect(await insertSchedule(c, { from: "2027-01-01", rate: "0.13" })).toBeNull();
    const rows = await db.commissionSchedule.findMany({ where: { agreementId: c.agreement.id }, orderBy: { rate: "asc" } });
    expect(rows.map((r) => r.rate?.toString())).toEqual(["0.12", "0.13", "0.14", "0.15"]);
  });

  it("rejects bad amounts, missing approver, and reversed dates", async () => {
    const c = await marketChain(db);
    expect(await insertSchedule(c, { from: "2026-01-01", rate: "1.5" })).toBe(PG.CHECK_VIOLATION);
    expect(await insertSchedule(c, { from: "2026-01-01", to: "2025-12-31" })).toBe(PG.CHECK_VIOLATION);
    expect(
      await pgErrorCode(sql,
        `insert into commission_schedules (agreement_id, product_id, transaction_type, basis, rate, effective_from, status)
         values ($1, $2, 'NEW', 'RATE', 0.1, '2026-01-01', 'APPROVED')`, [c.agreement.id, c.product.id]),
    ).toBe(PG.CHECK_VIOLATION);
    expect(await insertSchedule(c, { from: "2026-01-01", basis: "FLAT", rate: undefined })).toBe(PG.CHECK_VIOLATION);
  });

  it("preserves decimal precision (no floating-point money)", async () => {
    const c = await marketChain(db);
    const s = await db.commissionSchedule.create({
      data: { agreementId: c.agreement.id, productId: c.product.id, transactionType: "OTHER", basis: "RATE", rate: new Prisma.Decimal("0.123457"), effectiveFrom: new Date("2026-01-01") },
    });
    const tier = await db.commissionTier.create({ data: { scheduleId: s.id, thresholdMin: new Prisma.Decimal("0.01"), thresholdMax: new Prisma.Decimal("9999999999999999.99"), flatAmount: new Prisma.Decimal("1234567890123456.78") } });
    const back = await db.commissionTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(back.flatAmount?.toString()).toBe("1234567890123456.78");
    expect(back.thresholdMax?.toString()).toBe("9999999999999999.99");
    expect((await db.commissionSchedule.findUniqueOrThrow({ where: { id: s.id } })).rate?.toString()).toBe("0.123457");
  });

  it("requires a source document, approver and time on an APPROVED agreement", async () => {
    const c = await marketChain(db);
    const base = `insert into commission_agreements (agency_entity_id, market_channel_id, status, source_document_version_id, approved_by, approved_at) values ($1, $2, 'APPROVED', $3, $4, $5)`;
    expect(await pgErrorCode(sql, base, [c.agency.id, c.channel.id, null, c.user.id, new Date()])).toBe(PG.CHECK_VIOLATION);
    expect(await pgErrorCode(sql, base, [c.agency.id, c.channel.id, c.documentVersion.id, null, null])).toBe(PG.CHECK_VIOLATION);
    expect(await pgErrorCode(sql, base, [c.agency.id, c.channel.id, c.documentVersion.id, c.user.id, new Date()])).toBeNull();
  });
});

describe("agency codes", () => {
  const insertCode = (appointmentId: string, value: string, from: string, to: string | null, status = "ACTIVE") =>
    pgErrorCode(sql,
      `insert into agency_codes (appointment_id, code_type, code_value, effective_from, effective_to, status) values ($1, 'PRODUCER', $2, $3, $4, $5::"ActiveStatus")`,
      [appointmentId, value, from, to, status]);

  it("rejects duplicate overlapping ACTIVE codes and keeps historical ones", async () => {
    const c = await marketChain(db);
    expect(await insertCode(c.appointment.id, "P-100", "2025-01-01", "2025-12-31")).toBeNull();
    expect(await insertCode(c.appointment.id, "P-100", "2026-01-01", null)).toBeNull(); // re-issued after the old one ended
    expect(await insertCode(c.appointment.id, "P-100", "2026-06-01", null)).toBe(PG.EXCLUSION_VIOLATION);
    expect(await insertCode(c.appointment.id, "P-100", "2026-06-01", null, "INACTIVE")).toBeNull();
    expect(await insertCode(c.appointment.id, "P-200", "2026-06-01", null)).toBeNull();
  });

  it("supports many appointments and codes per agency entity, and rejects reversed dates", async () => {
    const c = await marketChain(db);
    const other = await db.agencyAppointment.create({ data: { agencyEntityId: c.agency.id, marketChannelId: c.channel.id, appointmentType: "DIRECT", status: "PENDING" } });
    expect(await insertCode(other.id, "M-1", "2026-01-01", null)).toBeNull();
    expect(await insertCode(c.appointment.id, "M-1", "2026-01-01", null)).toBeNull();
    expect(await db.agencyAppointment.count({ where: { agencyEntityId: c.agency.id } })).toBe(2);
    expect(await insertCode(c.appointment.id, "M-2", "2026-01-01", "2025-01-01")).toBe(PG.CHECK_VIOLATION);
  });
});

describe("appetite", () => {
  it("requires owner, approver and effective date on an APPROVED profile", async () => {
    const c = await marketChain(db);
    const q = `insert into appetite_profiles (carrier_product_id, version, status, owner_user_id, approved_by, approved_at, effective_from) values ($1, $2, 'APPROVED', $3, $4, $5, $6)`;
    expect(await pgErrorCode(sql, q, [c.carrierProduct.id, 1, null, c.user.id, new Date(), "2026-01-01"])).toBe(PG.CHECK_VIOLATION);
    expect(await pgErrorCode(sql, q, [c.carrierProduct.id, 1, c.user.id, c.user.id, new Date(), null])).toBe(PG.CHECK_VIOLATION);
    expect(await pgErrorCode(sql, q, [c.carrierProduct.id, 1, c.user.id, c.user.id, new Date(), "2026-01-01"])).toBeNull();
  });

  it("keeps historical versions retrievable and rejects a duplicate version number", async () => {
    const c = await marketChain(db);
    await db.appetiteProfile.create({ data: { carrierProductId: c.carrierProduct.id, version: 1, status: "RETIRED", effectiveFrom: new Date("2025-01-01"), effectiveTo: new Date("2025-12-31") } });
    await db.appetiteProfile.create({ data: { carrierProductId: c.carrierProduct.id, version: 2, status: "DRAFT", effectiveFrom: new Date("2026-01-01") } });
    const q = `insert into appetite_profiles (carrier_product_id, version) values ($1, 2)`;
    expect(await pgErrorCode(sql, q, [c.carrierProduct.id])).toBe(PG.UNIQUE_VIOLATION);
    const versions = await db.appetiteProfile.findMany({ where: { carrierProductId: c.carrierProduct.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.version, v.status])).toEqual([[1, "RETIRED"], [2, "DRAFT"]]);
  });

  it("distinguishes UNKNOWN from ACCEPTED and defaults a rule to UNKNOWN", async () => {
    const c = await marketChain(db);
    const p = await db.appetiteProfile.create({ data: { carrierProductId: c.carrierProduct.id, version: 1 } });
    const rule = await db.appetiteRule.create({ data: { profileId: p.id } });
    expect(rule.outcome).toBe("UNKNOWN");
  });

  it("requires an operator and value when a rule names an attribute", async () => {
    const c = await marketChain(db);
    const p = await db.appetiteProfile.create({ data: { carrierProductId: c.carrierProduct.id, version: 1 } });
    const attr = await db.riskAttributeDefinition.create({ data: { productId: c.product.id, key: "annual_revenue", label: "Annual revenue", dataType: "MONEY", unit: "USD" } });
    const q = `insert into appetite_rules (profile_id, attribute_definition_id, operator, typed_value, outcome) values ($1, $2, $3::"RuleOperator", $4, 'ACCEPTED')`;
    expect(await pgErrorCode(sql, q, [p.id, attr.id, null, null])).toBe(PG.CHECK_VIOLATION);
    expect(await pgErrorCode(sql, q, [p.id, attr.id, "LTE", JSON.stringify({ amount: "5000000.00" })])).toBeNull();
  });
});

describe("audit events are append-only", () => {
  it("allows insert and rejects update, delete and truncate", async () => {
    const row = await db.auditEvent.create({ data: { action: "test.insert", entityType: "test" } });
    expect(await pgErrorCode(sql, `update audit_events set action = 'tampered' where id = $1`, [row.id])).toBe(PG.INSUFFICIENT_PRIVILEGE);
    expect(await pgErrorCode(sql, `delete from audit_events where id = $1`, [row.id])).toBe(PG.INSUFFICIENT_PRIVILEGE);
    expect(await pgErrorCode(sql, `truncate audit_events`)).toBe(PG.INSUFFICIENT_PRIVILEGE);
    expect((await db.auditEvent.findUniqueOrThrow({ where: { id: row.id } })).action).toBe("test.insert");
  });
});

describe("carrier model", () => {
  it("archiving keeps history; hard delete of a referenced carrier is refused", async () => {
    const c = await marketChain(db);
    await db.organization.update({ where: { id: c.insurer.id }, data: { archivedAt: new Date(), status: "INACTIVE" } });
    const cp = await db.carrierProduct.findUniqueOrThrow({ where: { id: c.carrierProduct.id }, include: { writingCompany: true } });
    expect(cp.writingCompany.archivedAt).not.toBeNull();
    expect(await pgErrorCode(sql, `delete from organizations where id = $1`, [c.insurer.id])).toBe(PG.FOREIGN_KEY_VIOLATION);
  });

  it("one product supports several writing companies and intermediary channels", async () => {
    const c = await marketChain(db);
    const second = await db.organization.create({ data: { legalName: `TEST Second ${c.t}`, displayName: `TEST Second ${c.t}`, type: "INSURER" } });
    const mga = await db.organization.create({ data: { legalName: `TEST MGA ${c.t}`, displayName: `TEST MGA ${c.t}`, type: "MGA" } });
    const wholesaler = await db.organization.create({ data: { legalName: `TEST Wholesale ${c.t}`, displayName: `TEST Wholesale ${c.t}`, type: "WHOLESALER" } });
    const cp2 = await db.carrierProduct.create({ data: { writingCompanyId: second.id, productId: c.product.id } });
    await db.marketChannel.create({ data: { carrierProductId: cp2.id, intermediaryOrgId: mga.id, distributionType: "MGA" } });
    await db.marketChannel.create({ data: { carrierProductId: cp2.id, intermediaryOrgId: wholesaler.id, distributionType: "WHOLESALE" } });
    await db.organizationRelationship.create({ data: { fromOrgId: mga.id, toOrgId: second.id, relationshipType: "MGA_FOR" } });
    const product = await db.insuranceProduct.findUniqueOrThrow({ where: { id: c.product.id }, include: { carrierProducts: { include: { channels: true } } } });
    expect(product.carrierProducts).toHaveLength(2);
    expect(product.carrierProducts.flatMap((p) => p.channels)).toHaveLength(3);
    expect(await pgErrorCode(sql, `insert into organization_relationships (from_org_id, to_org_id, relationship_type) values ($1, $1, 'OTHER')`, [mga.id])).toBe(PG.CHECK_VIOLATION);
  });

  it("rejects a duplicate identifier (type, value, jurisdiction)", async () => {
    const c = await marketChain(db);
    const q = `insert into organization_identifiers (organization_id, type, value, jurisdiction) values ($1, 'NAIC', $2, $3)`;
    expect(await pgErrorCode(sql, q, [c.insurer.id, `9${c.t}`, null])).toBeNull();
    expect(await pgErrorCode(sql, q, [c.insurer.id, `9${c.t}`, null])).toBe(PG.UNIQUE_VIOLATION);
  });
});

describe("contacts", () => {
  it("one contact has several carrier/territory assignments, active and inactive", async () => {
    const c = await marketChain(db);
    const [tn, ga] = await Promise.all([
      db.territory.findFirstOrThrow({ where: { stateCode: "TN" } }),
      db.territory.findFirstOrThrow({ where: { stateCode: "GA" } }),
    ]);
    const person = await db.contact.create({ data: { firstName: "Test", lastName: `Person ${c.t}`, verifiedAt: new Date("2026-10-01") } });
    await db.contactAssignment.create({ data: { contactId: person.id, organizationId: c.insurer.id, territoryId: tn.id, role: "UNDERWRITER" } });
    await db.contactAssignment.create({ data: { contactId: person.id, organizationId: c.insurer.id, territoryId: ga.id, role: "MARKETING_REP", effectiveFrom: new Date("2024-01-01"), effectiveTo: new Date("2025-06-30") } });
    const back = await db.contact.findUniqueOrThrow({ where: { id: person.id }, include: { assignments: true } });
    expect(back.assignments).toHaveLength(2);
    expect(back.verifiedAt?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("portals and provenance", () => {
  it("carrier_portals has no credential columns and only accepts http(s) URLs", async () => {
    const { rows } = await sql.query(`select column_name from information_schema.columns where table_name = 'carrier_portals'`);
    const cols = rows.map((r) => r.column_name as string);
    expect(cols.filter((n) => /pass|secret|pin|token|mfa|username|login/i.test(n))).toEqual([]);
    const c = await marketChain(db);
    expect(await pgErrorCode(sql, `insert into carrier_portals (organization_id, name, url) values ($1, 'x', 'javascript:alert(1)')`, [c.insurer.id])).toBe(PG.CHECK_VIOLATION);
  });

  it("record_sources enforces document/import links and AI-only confidence", async () => {
    const c = await marketChain(db);
    const q = `insert into record_sources (record_type, record_id, source_kind, document_version_id, confidence, created_by) values ('APPETITE_PROFILE', $1, $2::"SourceKind", $3, $4, $5)`;
    expect(await pgErrorCode(sql, q, [c.carrierProduct.id, "DOCUMENT", null, null, c.user.id])).toBe(PG.CHECK_VIOLATION);
    expect(await pgErrorCode(sql, q, [c.carrierProduct.id, "IMPORT", null, null, c.user.id])).toBe(PG.CHECK_VIOLATION);
    expect(await pgErrorCode(sql, q, [c.carrierProduct.id, "USER_ENTERED", null, 0.9, c.user.id])).toBe(PG.CHECK_VIOLATION);
    expect(await pgErrorCode(sql, q, [c.carrierProduct.id, "DOCUMENT", c.documentVersion.id, null, c.user.id])).toBeNull();
  });
});

describe("scope", () => {
  it("has no life, health, benefits, disability or LTC tables", async () => {
    const { rows } = await sql.query(`select table_name from information_schema.tables where table_schema = 'public'`);
    const names = rows.map((r) => r.table_name as string);
    expect(names.filter((n) => /life|health|benefit|disab|ltc|medical|enroll/i.test(n))).toEqual([]);
  });
});
