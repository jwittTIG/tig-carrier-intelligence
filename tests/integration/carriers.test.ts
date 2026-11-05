import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import * as svc from "@/server/services/carriers";
import { demoContext } from "../support/auth";
import { testPrisma } from "../support/db";

const db = testPrisma();
let staff: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
});

const t = () => randomUUID().slice(0, 8);
const newCarrier = (overrides: Record<string, unknown> = {}) => {
  const n = t();
  return svc.createCarrier(staff, { legalName: `TEST Legal ${n} Insurance Co`, displayName: `TEST Carrier ${n}`, type: "INSURER", ...overrides });
};
const auditsFor = (entityId: string) => db.auditEvent.findMany({ where: { entityId }, orderBy: { occurredAt: "asc" } });

describe("carrier writes are audited", () => {
  it("create records an audit row with actor, after-state and correlation id", async () => {
    const c = await newCarrier();
    const [a] = await auditsFor(c.id);
    expect(a.action).toBe("carrier.create");
    expect(a.actorId).toBe(staff.userId);
    expect(a.correlationId).toBe(staff.correlationId);
    expect((a.afterState as { displayName: string }).displayName).toBe(c.displayName);
    expect(a.beforeState).toBeNull();
  });

  it("update records before and after", async () => {
    const c = await newCarrier();
    await svc.updateCarrier(staff, c.id, { displayName: `${c.displayName} renamed`, status: "INACTIVE" });
    const rows = await auditsFor(c.id);
    const u = rows.find((r) => r.action === "carrier.update")!;
    expect((u.beforeState as { status: string }).status).toBe("ACTIVE");
    expect((u.afterState as { status: string; displayName: string }).displayName).toBe(`${c.displayName} renamed`);
  });

  it("every write in the carrier service adds exactly one audit row per record touched", async () => {
    const insurer = await newCarrier();
    const mga = await newCarrier({ type: "MGA" });
    const gl = (await svc.listLines(staff)).find((l) => l.code === "GENERAL_LIABILITY")!;
    const before = await db.auditEvent.count();
    const cp = await svc.addCarrierProduct(staff, insurer.id, { newProductLineId: gl.id, newProductName: `TEST GL ${t()}` }); // +2 (product, carrier product)
    const ch = await svc.addChannel(staff, insurer.id, cp.id, { distributionType: "MGA", intermediaryOrgId: mga.id }); // +1
    await svc.setChannelArchived(staff, insurer.id, ch.id, true); // +1
    await svc.setCarrierProductArchived(staff, insurer.id, cp.id, true); // +1
    const rel = await svc.addRelationship(staff, mga.id, { toOrgId: insurer.id, relationshipType: "MGA_FOR", effectiveFrom: "2026-01-01" }); // +1
    await svc.endRelationship(staff, mga.id, rel.id, { effectiveTo: "2026-12-31" }); // +1
    const ident = await svc.addIdentifier(staff, insurer.id, { type: "naic", value: `9${t()}` }); // +1
    await svc.removeIdentifier(staff, insurer.id, ident.id); // +1
    await svc.addActivity(staff, insurer.id, { notes: "TEST call with underwriter" }); // +1
    await svc.setCarrierArchived(staff, insurer.id, true); // +1
    await svc.setCarrierArchived(staff, insurer.id, false); // +1
    expect((await db.auditEvent.count()) - before).toBe(12);
  });
});

describe("directory search and archive", () => {
  it("finds by display name, legal name (case-insensitive) and exact identifier", async () => {
    const n = t();
    const c = await svc.createCarrier(staff, { legalName: `TEST Zephyr ${n} Casualty`, displayName: `TEST Z ${n}`, type: "INSURER" });
    await svc.addIdentifier(staff, c.id, { type: "NAIC", value: `7${n}` });
    expect((await svc.listCarriers(staff, { q: `zephyr ${n}` })).items.map((i) => i.id)).toEqual([c.id]);
    expect((await svc.listCarriers(staff, { q: `7${n}` })).items.map((i) => i.id)).toEqual([c.id]);
  });

  it("filters by type, group and line; never returns agency entities", async () => {
    const wholesalers = await svc.listCarriers(staff, { type: "WHOLESALER", pageSize: 100 });
    expect(wholesalers.items.every((i) => i.type === "WHOLESALER")).toBe(true);
    const all = await svc.listCarriers(staff, { pageSize: 100, includeArchived: true });
    expect(all.items.some((i) => i.type === "AGENCY")).toBe(false);
    const gl = (await svc.listLines(staff)).find((l) => l.code === "GENERAL_LIABILITY")!;
    const glCarriers = await svc.listCarriers(staff, { lineId: gl.id, q: "DEMO" });
    expect(glCarriers.items.map((i) => i.displayName).sort()).toEqual(["DEMO Ridgeline Specialty", "DEMO Summit Mutual"]);
    const group = (await svc.listCarriers(staff, { type: "GROUP", q: "DEMO Summit" })).items[0];
    expect((await svc.listCarriers(staff, { parentId: group.id })).items.map((i) => i.displayName)).toEqual(["DEMO Summit Mutual"]);
  });

  it("archived carriers leave the default list but stay retrievable and restorable", async () => {
    const c = await newCarrier();
    await svc.setCarrierArchived(staff, c.id, true);
    expect((await svc.listCarriers(staff, { q: c.displayName })).total).toBe(0);
    expect((await svc.listCarriers(staff, { q: c.displayName, includeArchived: "on" })).total).toBe(1);
    expect((await svc.getCarrier(staff, c.id)).archivedAt).not.toBeNull();
    await svc.setCarrierArchived(staff, c.id, false);
    expect((await svc.listCarriers(staff, { q: c.displayName })).total).toBe(1);
  });

  it("paginates with a stable order", async () => {
    const p1 = await svc.listCarriers(staff, { pageSize: 2, page: 1, includeArchived: true });
    const p2 = await svc.listCarriers(staff, { pageSize: 2, page: 2, includeArchived: true });
    expect(p1.items).toHaveLength(2);
    expect(p1.items.map((i) => i.id)).not.toContain(p2.items[0]?.id);
  });
});

describe("ID substitution and validation", () => {
  it("treats agency entities, unknown ids and malformed ids as not found", async () => {
    const agency = await db.organization.findFirstOrThrow({ where: { type: "AGENCY" } });
    await expect(svc.getCarrier(staff, agency.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.updateCarrier(staff, agency.id, { displayName: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.getCarrier(staff, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.getCarrier(staff, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("can't touch another carrier's products, channels, identifiers or relationships through this one", async () => {
    const a = await newCarrier();
    const b = await newCarrier();
    const products = await svc.listProducts(staff);
    const cpB = await svc.addCarrierProduct(staff, b.id, { productId: products[0].id });
    const chB = await svc.addChannel(staff, b.id, cpB.id, { distributionType: "DIRECT" });
    const idB = await svc.addIdentifier(staff, b.id, { type: "FEIN", value: `00-${t()}` });
    await expect(svc.addChannel(staff, a.id, cpB.id, { distributionType: "DIRECT" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.setChannelArchived(staff, a.id, chB.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.setCarrierProductArchived(staff, a.id, cpB.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.removeIdentifier(staff, a.id, idB.id)).rejects.toBeInstanceOf(NotFoundError);
    const rel = await svc.addRelationship(staff, b.id, { toOrgId: (await newCarrier()).id, relationshipType: "OTHER" });
    await expect(svc.endRelationship(staff, a.id, rel.id, { effectiveTo: "2026-12-31" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects AGENCY type, bad URLs, missing names, and parent cycles", async () => {
    await expect(newCarrier({ type: "AGENCY" })).rejects.toBeInstanceOf(ValidationError);
    await expect(newCarrier({ website: "javascript:alert(1)" })).rejects.toBeInstanceOf(ValidationError);
    await expect(newCarrier({ displayName: "  " })).rejects.toBeInstanceOf(ValidationError);
    const group = await newCarrier({ type: "GROUP" });
    const member = await newCarrier({ parentId: group.id });
    await expect(svc.updateCarrier(staff, group.id, { parentId: member.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.updateCarrier(staff, group.id, { parentId: group.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces channel rules and P&C product ownership", async () => {
    const insurer = await newCarrier();
    const wholesaler = await newCarrier({ type: "WHOLESALER" });
    const otherInsurer = await newCarrier();
    const products = await svc.listProducts(staff);
    const cp = await svc.addCarrierProduct(staff, insurer.id, { productId: products[0].id });
    await expect(svc.addChannel(staff, insurer.id, cp.id, { distributionType: "DIRECT", intermediaryOrgId: wholesaler.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addChannel(staff, insurer.id, cp.id, { distributionType: "WHOLESALE" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addChannel(staff, insurer.id, cp.id, { distributionType: "WHOLESALE", intermediaryOrgId: otherInsurer.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addChannel(staff, insurer.id, cp.id, { distributionType: "WHOLESALE", intermediaryOrgId: wholesaler.id })).resolves.toBeTruthy();
    await expect(svc.addCarrierProduct(staff, wholesaler.id, { productId: products[0].id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects self-relationships, reversed dates and duplicate identifiers", async () => {
    const a = await newCarrier();
    const b = await newCarrier();
    await expect(svc.addRelationship(staff, a.id, { toOrgId: a.id, relationshipType: "OTHER" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addRelationship(staff, a.id, { toOrgId: b.id, relationshipType: "OTHER", effectiveFrom: "2026-05-01", effectiveTo: "2026-01-01" })).rejects.toBeInstanceOf(ValidationError);
    const rel = await svc.addRelationship(staff, a.id, { toOrgId: b.id, relationshipType: "OTHER", effectiveFrom: "2026-05-01" });
    await expect(svc.endRelationship(staff, a.id, rel.id, { effectiveTo: "2026-04-01" })).rejects.toBeInstanceOf(ValidationError);
    const value = `5${t()}`;
    await svc.addIdentifier(staff, a.id, { type: "NAIC", value });
    await expect(svc.addIdentifier(staff, b.id, { type: "NAIC", value })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("history", () => {
  it("includes the carrier and the records that hang off it", async () => {
    const a = await newCarrier();
    const b = await newCarrier({ type: "WHOLESALER" });
    await svc.updateCarrier(staff, a.id, { status: "PROSPECT" });
    await svc.addRelationship(staff, b.id, { toOrgId: a.id, relationshipType: "WHOLESALER_FOR" });
    const ident = await svc.addIdentifier(staff, a.id, { type: "NAIC", value: `3${t()}` });
    await svc.removeIdentifier(staff, a.id, ident.id);
    const actions = (await svc.listCarrierHistory(staff, a.id)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["carrier.create", "carrier.update", "carrier.relationship.add", "carrier.identifier.add", "carrier.identifier.remove"]));
  });
});
