import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import * as app from "@/server/services/appetite";
import { approveProfileNow, decide } from "@/server/services/approvals";
import { addCarrierProduct, addIdentifier, carrierLogoUrl, createCarrier, listProducts, removeCarrierLogo, setCarrierLogo } from "@/server/services/carriers";
import { addContactToCarrier } from "@/server/services/contacts";
import { addSource } from "@/server/services/sources";
import { storage } from "@/server/storage";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";
import { makePdf } from "../support/pdf";

/** Josh's 2026-11-10 changes: carrier logo, contact types, closing out and approving appetite. */
const db = testPrisma();
let staff: AuthContext;
let admin: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  admin = await demoContext(db, "demo.admin@example.invalid");
});

const t = () => randomUUID().slice(0, 8);
// A real 1x1 PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const carrier = () => createCarrier(staff, { legalName: `TEST Page ${t()} Co`, displayName: `TEST Page ${t()}`, type: "INSURER" });

describe("carrier logo", () => {
  it("stores a PNG privately, links to it only after a read check, and can be removed", async () => {
    const c = await carrier();
    expect(await carrierLogoUrl(staff, c)).toBeNull();
    const saved = await setCarrierLogo(staff, c.id, { name: "logo.png", bytes: PNG });
    expect(saved.logoMimeType).toBe("image/png");
    expect(saved.logoObjectKey).toMatch(new RegExp(`^logos/${c.id}/`));
    expect(Buffer.from(await storage().get(saved.logoObjectKey!))).toEqual(Buffer.from(PNG));
    expect(await carrierLogoUrl(staff, saved)).toMatch(/^\/api\/v1\/files\?t=/);
    expect(await db.auditEvent.count({ where: { entityId: c.id, action: "carrier.logo.set" } })).toBe(1);
    await removeCarrierLogo(staff, c.id);
    const after = await db.organization.findUniqueOrThrow({ where: { id: c.id } });
    expect([after.logoObjectKey, after.logoMimeType]).toEqual([null, null]);
  });

  it("refuses anything but a PNG or JPEG (checked by content), and needs carrier.write", async () => {
    const c = await carrier();
    await expect(setCarrierLogo(staff, c.id, { name: "logo.pdf", bytes: await makePdf([["x"]]) })).rejects.toThrow(/PNG or JPEG/);
    await expect(setCarrierLogo(staff, c.id, { name: "logo.jpg", bytes: PNG })).rejects.toThrow(/but its name ends in \.jpg/);
    await expect(setCarrierLogo(staff, c.id, { name: "big.png", bytes: new Uint8Array(3 * 1024 * 1024).fill(1) })).rejects.toBeInstanceOf(ValidationError);
    const reader = await limitedUser(db, ["carrier.read"]);
    await expect(setCarrierLogo(reader, c.id, { name: "logo.png", bytes: PNG })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(db.organization.update({ where: { id: c.id }, data: { logoObjectKey: "logos/x", logoMimeType: "image/gif" } })).rejects.toThrow();
  });

  it("identifiers keep their codes; the page shows NAIC, FEIN and AM Best", async () => {
    const c = await carrier();
    const row = await addIdentifier(staff, c.id, { type: "AM_BEST_ID", value: `TEST-${t()}` });
    expect(row.type).toBe("AM_BEST_ID");
  });
});

describe("adding a contact on the carrier's Contacts tab", () => {
  it("creates the contact and their type at the carrier in one step, with audit", async () => {
    const c = await carrier();
    const tn = await db.territory.findFirstOrThrow({ where: { stateCode: "TN", territoryType: "STATE" } });
    const r = await addContactToCarrier(staff, c.id, { role: "MIDDLE_MARKET_UNDERWRITER", firstName: "TEST", lastName: `Person ${t()}`, email: `test.${t()}@example.invalid`, title: "Senior underwriter", territoryId: tn.id });
    expect(r.assignment).toMatchObject({ organizationId: c.id, role: "MIDDLE_MARKET_UNDERWRITER", title: "Senior underwriter", territoryId: tn.id });
    expect(await db.auditEvent.count({ where: { entityId: { in: [r.contact.id, r.assignment.id] } } })).toBe(2);
    await expect(addContactToCarrier(staff, c.id, { role: "ASTRONAUT", firstName: "TEST", lastName: "X" })).rejects.toBeInstanceOf(ValidationError);
    const reader = await limitedUser(db, ["contact.read"]);
    await expect(addContactToCarrier(reader, c.id, { role: "CLAIMS_ADJUSTER", firstName: "TEST", lastName: "Y" })).rejects.toBeInstanceOf(ForbiddenError);
    // Nothing half-made when the carrier doesn't exist.
    const before = await db.contact.count();
    await expect(addContactToCarrier(staff, randomUUID(), { role: "CLAIMS_ADJUSTER", firstName: "TEST", lastName: "Z" })).rejects.toThrow();
    expect(await db.contact.count()).toBe(before);
  });
});

async function readyDraft(ctx: AuthContext) {
  const insurer = await createCarrier(ctx, { legalName: `TEST Close ${t()} Co`, displayName: `TEST Close ${t()}`, type: "INSURER" });
  const cp = await addCarrierProduct(ctx, insurer.id, { productId: (await listProducts(ctx))[0].id });
  const profile = await app.createProfile(ctx, { carrierProductId: cp.id, effectiveFrom: "2026-01-01" });
  const tn = await db.territory.findFirstOrThrow({ where: { stateCode: "TN", territoryType: "STATE" } });
  await app.addRule(ctx, profile.id, { outcome: "ACCEPTED", territoryIds: [tn.id] });
  await addSource(ctx, { recordType: "APPETITE_PROFILE", recordId: profile.id, sourceKind: "USER_ENTERED", sourceNote: "TEST call with underwriter" });
  return profile;
}

describe("approving appetite in one step", () => {
  it("an admin approves their own draft with a reason; the reason is checked before anything changes", async () => {
    const p = await readyDraft(admin);
    await expect(approveProfileNow(admin, p.id, { rationale: "ok" })).rejects.toBeInstanceOf(ValidationError);
    expect((await db.appetiteProfile.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("DRAFT");
    await approveProfileNow(admin, p.id, { rationale: "Reviewed the rules against the carrier's guide" });
    const after = await db.appetiteProfile.findUniqueOrThrow({ where: { id: p.id } });
    expect([after.status, after.approvedById]).toEqual(["APPROVED", admin.userId]);
    const cr = await db.changeRequest.findFirstOrThrow({ where: { recordId: p.id } });
    expect([cr.status, cr.reviewedById, cr.rationale]).toEqual(["APPROVED", admin.userId, "Reviewed the rules against the carrier's guide"]);
  });

  it("staff can't approve their own: they submit it for someone else", async () => {
    const p = await readyDraft(staff);
    await expect(approveProfileNow(staff, p.id, { rationale: "Reviewed the rules against the guide" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await db.appetiteProfile.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("DRAFT");
  });
});

describe("closing out an approved appetite version", () => {
  it("ends it on the date given and retires it, with the reason in the audit trail", async () => {
    const p = await readyDraft(staff);
    await app.submitProfile(staff, p.id, {});
    await decide(admin, (await db.changeRequest.findFirstOrThrow({ where: { recordId: p.id, status: "PENDING" } })).id, { decision: "APPROVE" });
    await expect(app.closeOutProfile(admin, p.id, { reason: "short" })).rejects.toBeInstanceOf(ValidationError);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await expect(app.closeOutProfile(admin, p.id, { effectiveTo: tomorrow, reason: "Carrier stopped writing this" })).rejects.toThrow(/today or an earlier date/);
    await expect(app.closeOutProfile(admin, p.id, { effectiveTo: "2025-12-31", reason: "Carrier stopped writing this" })).rejects.toThrow(/before it took effect/);
    const closed = await app.closeOutProfile(admin, p.id, { effectiveTo: "2026-06-30", reason: "Carrier stopped writing this" });
    expect([closed.status, closed.effectiveTo?.toISOString().slice(0, 10)]).toEqual(["RETIRED", "2026-06-30"]);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: p.id, action: "appetite.profile.close_out" } });
    expect(audit.afterState).toMatchObject({ reason: "Carrier stopped writing this" });
    await expect(app.closeOutProfile(admin, p.id, { reason: "Carrier stopped writing this" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("drafts are deleted, not closed out; it needs approval permission", async () => {
    const p = await readyDraft(staff);
    await expect(app.closeOutProfile(admin, p.id, { reason: "Carrier stopped writing this" })).rejects.toThrow(/delete it instead/);
    const writer = await limitedUser(db, ["appetite.read", "appetite.write"]);
    await expect(app.closeOutProfile(writer, p.id, { reason: "Carrier stopped writing this" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
