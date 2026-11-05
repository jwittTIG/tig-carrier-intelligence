import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import { createCarrier, listLines, listProducts } from "@/server/services/carriers";
import * as svc from "@/server/services/contacts";
import { demoContext } from "../support/auth";
import { testPrisma } from "../support/db";

const db = testPrisma();
let staff: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
});

const t = () => randomUUID().slice(0, 8);
const state = (code: string) => db.territory.findFirstOrThrow({ where: { stateCode: code, territoryType: "STATE" } });
const us = () => db.territory.findFirstOrThrow({ where: { territoryType: "COUNTRY", countryCode: "US" } });
const carrier = () => createCarrier(staff, { legalName: `TEST C ${t()} Co`, displayName: `TEST C ${t()}`, type: "INSURER" });
const person = (o: Record<string, unknown> = {}) => svc.createContact(staff, { firstName: "Test", lastName: `Rep ${t()}`, email: `rep.${t()}@example.invalid`, ...o });

describe("contacts", () => {
  it("one contact holds several assignments across carriers and territories; history is audited", async () => {
    const [a, b] = [await carrier(), await carrier()];
    const c = await person();
    const tn = await state("TN");
    const ga = await state("GA");
    await svc.addAssignment(staff, c.id, { organizationId: a.id, role: "UNDERWRITER", territoryId: tn.id });
    await svc.addAssignment(staff, c.id, { organizationId: a.id, role: "UNDERWRITER", territoryId: ga.id });
    await svc.addAssignment(staff, c.id, { organizationId: b.id, role: "MARKETING_REP" });
    const full = await svc.getContact(staff, c.id);
    expect(full.assignments).toHaveLength(3);
    const actions = (await svc.listContactHistory(staff, c.id)).map((e) => e.action);
    expect(actions.filter((x) => x === "contact.assignment.add")).toHaveLength(3);
    expect(actions).toContain("contact.create");
  });

  it("finds the rep for a carrier + state + line; nationwide counts, unrecorded territory doesn't", async () => {
    const insurer = await carrier();
    const gl = (await listLines(staff)).find((l) => l.code === "GENERAL_LIABILITY")!;
    const glProduct = (await listProducts(staff)).find((p) => p.line.name === gl.name)!;
    const tnRep = await person({ lastName: `TNrep ${t()}` });
    const nationwide = await person({ lastName: `USrep ${t()}` });
    const noTerritory = await person({ lastName: `Norep ${t()}` });
    const a1 = await svc.addAssignment(staff, tnRep.id, { organizationId: insurer.id, role: "UNDERWRITER", territoryId: (await state("TN")).id });
    await svc.addSpecialty(staff, tnRep.id, a1.id, { productId: glProduct.id });
    const a2 = await svc.addAssignment(staff, nationwide.id, { organizationId: insurer.id, role: "UNDERWRITER", territoryId: (await us()).id });
    await svc.addSpecialty(staff, nationwide.id, a2.id, { productId: glProduct.id });
    await svc.addAssignment(staff, noTerritory.id, { organizationId: insurer.id, role: "UNDERWRITER" });

    const ids = (await svc.listContacts(staff, { organizationId: insurer.id, stateCode: "tn", pageSize: 100 })).items.map((i) => i.id).sort();
    expect(ids).toEqual([tnRep.id, nationwide.id].sort());
    const withLine = (await svc.listContacts(staff, { organizationId: insurer.id, lineId: gl.id, pageSize: 100 })).items.map((i) => i.id).sort();
    expect(withLine).toEqual([tnRep.id, nationwide.id].sort());
    expect((await svc.listContacts(staff, { organizationId: insurer.id, stateCode: "KY" })).items.map((i) => i.id)).toEqual([nationwide.id]);
  });

  it("ended assignments don't match the rep search but stay on the contact", async () => {
    const insurer = await carrier();
    const c = await person();
    const a = await svc.addAssignment(staff, c.id, { organizationId: insurer.id, role: "UNDERWRITER", effectiveFrom: "2024-01-01" });
    await svc.endAssignment(staff, c.id, a.id, { effectiveTo: "2025-01-31" });
    expect((await svc.listContacts(staff, { organizationId: insurer.id })).total).toBe(0);
    const full = await svc.getContact(staff, c.id);
    expect(full.assignments[0].current).toBe(false);
    await expect(svc.endAssignment(staff, c.id, a.id, { effectiveTo: "2023-01-01" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("verification records who/when/how, sets the next review, and clears stale", async () => {
    const c = await person();
    expect((await svc.getContact(staff, c.id)).freshness.state).toBe("NEVER_VERIFIED");
    expect((await svc.listContacts(staff, { q: c.lastName, freshness: "stale" })).total).toBe(1);
    await expect(svc.verifyContact(staff, c.id, { sourceNote: "" })).rejects.toBeInstanceOf(ValidationError);
    const ev = await svc.verifyContact(staff, c.id, { sourceNote: "Called the office" });
    expect(ev.verifiedById).toBe(staff.userId);
    expect(Math.round((ev.nextReviewAt!.getTime() - ev.verifiedAt.getTime()) / 86_400_000)).toBe(365);
    const full = await svc.getContact(staff, c.id);
    expect(full.freshness.state).toBe("FRESH");
    expect(full.verifications[0].sourceNote).toBe("Called the office");
    expect((await svc.listContacts(staff, { q: c.lastName, freshness: "stale" })).total).toBe(0);
    // An old confirmation is stale again.
    await db.contact.update({ where: { id: c.id }, data: { verifiedAt: new Date(Date.now() - 400 * 86_400_000) } });
    expect((await svc.getContact(staff, c.id)).freshness.state).toBe("STALE");
  });

  it("validates channel ownership, backups, and contact notes", async () => {
    const [a, b] = [await carrier(), await carrier()];
    const products = await listProducts(staff);
    const cpB = await db.carrierProduct.create({ data: { writingCompanyId: b.id, productId: products[0].id } });
    const chB = await db.marketChannel.create({ data: { carrierProductId: cpB.id, distributionType: "DIRECT" } });
    const c = await person();
    await expect(svc.addAssignment(staff, c.id, { organizationId: a.id, role: "UNDERWRITER", marketChannelId: chB.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addAssignment(staff, c.id, { organizationId: a.id, role: "UNDERWRITER", backupContactId: c.id })).rejects.toBeInstanceOf(ValidationError);
    const agency = await db.organization.findFirstOrThrow({ where: { type: "AGENCY" } });
    await expect(svc.addAssignment(staff, c.id, { organizationId: agency.id, role: "UNDERWRITER" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addContactActivity(staff, c.id, { organizationId: a.id, notes: "x" })).rejects.toBeInstanceOf(ValidationError);
    await svc.addAssignment(staff, c.id, { organizationId: a.id, role: "UNDERWRITER" });
    const note = await svc.addContactActivity(staff, c.id, { organizationId: a.id, notes: "TEST lunch meeting", type: "MEETING" });
    expect(note.contactId).toBe(c.id);
  });

  it("can't reach another contact's assignments or specialties (ID substitution)", async () => {
    const insurer = await carrier();
    const products = await listProducts(staff);
    const [c1, c2] = [await person(), await person()];
    const a2 = await svc.addAssignment(staff, c2.id, { organizationId: insurer.id, role: "UNDERWRITER" });
    const s2 = await svc.addSpecialty(staff, c2.id, a2.id, { productId: products[0].id });
    await expect(svc.endAssignment(staff, c1.id, a2.id, { effectiveTo: "2026-12-31" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.updateAssignment(staff, c1.id, a2.id, { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.addSpecialty(staff, c1.id, a2.id, { productId: products[0].id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.removeSpecialty(staff, c1.id, s2.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.getContact(staff, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a partial update changes only the fields given", async () => {
    const c = await person({ officePhone: "555-0100" });
    await svc.updateContact(staff, c.id, { lastName: "Renamed" });
    const after = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.lastName).toBe("Renamed");
    expect(after.officePhone).toBe("555-0100");
    expect(after.email).toBe(c.email);
  });
});
