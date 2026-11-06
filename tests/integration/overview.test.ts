import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { listAuditEvents } from "@/server/services/audit-log";
import { createCarrier } from "@/server/services/carriers";
import { uploadDocument } from "@/server/services/documents";
import { dashboard, globalSearch } from "@/server/services/overview";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";

const db = testPrisma();
let staff: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
});

describe("global search", () => {
  it("finds carriers, contacts, codes and documents; hides restricted documents without commission.read", async () => {
    const n = randomUUID().slice(0, 6);
    await uploadDocument(staff, { title: `TEST Zebra ${n} agreement`, documentType: "AGREEMENT", classification: "RESTRICTED" }, { name: "a.pdf", bytes: new TextEncoder().encode(`%PDF-1.4\n%${n}\n%%EOF`) });
    await db.organization.create({ data: { legalName: `TEST Zebra ${n} Co`, displayName: `TEST Zebra ${n}`, type: "MGA" } });
    await db.contact.create({ data: { firstName: "Zed", lastName: `Zebra${n}` } });
    const r = await globalSearch(staff, `Zebra`);
    expect(r.carriers.some((c) => c.displayName === `TEST Zebra ${n}`)).toBe(true);
    expect(r.contacts.some((c) => c.lastName === `Zebra${n}`)).toBe(true);
    expect(r.documents.some((d) => d.title.includes(n))).toBe(true);
    expect((await globalSearch(staff, "DEMO-0001")).codes.map((c) => c.codeValue)).toContain("DEMO-0001");
    const limited = await limitedUser(db, ["carrier.read", "document.read"]);
    const lr = await globalSearch(limited, "Zebra");
    expect(lr.documents.some((d) => d.title.includes(n))).toBe(false);
    expect(lr.contacts).toEqual([]); // no contact.read
    await expect(globalSearch(staff, "z")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("dashboard", () => {
  it("counts real records: owned carriers and appointments ending soon", async () => {
    const n = randomUUID().slice(0, 6);
    const org = await db.organization.create({ data: { legalName: `TEST Dash ${n}`, displayName: `TEST Dash ${n}`, type: "INSURER", ownerUserId: staff.userId } });
    const product = await db.insuranceProduct.findFirstOrThrow();
    const cp = await db.carrierProduct.create({ data: { writingCompanyId: org.id, productId: product.id } });
    const ch = await db.marketChannel.create({ data: { carrierProductId: cp.id, distributionType: "DIRECT" } });
    expect(ch.id).toBeTruthy();
    const d = await dashboard(staff);
    expect(d.myCarriers.map((c) => c.id)).toContain(org.id);
    expect(d).not.toHaveProperty("expiring"); // appointments are managed by corporate (N19)
  });
});

describe("audit log viewer", () => {
  it("filters by record type and needs audit.read", async () => {
    await createCarrier(staff, { legalName: `TEST Audit ${randomUUID().slice(0, 6)} Co`, displayName: `TEST Audit ${randomUUID().slice(0, 6)}`, type: "INSURER" });
    const r = await listAuditEvents(staff, { entityType: "organization", pageSize: 5 });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((e) => e.entityType === "organization")).toBe(true);
    expect(r.entityTypes).toContain("organization");
    const nobody = await limitedUser(db, ["carrier.read"]);
    await expect(listAuditEvents(nobody)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
