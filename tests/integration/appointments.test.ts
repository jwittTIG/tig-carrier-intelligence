import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import * as svc from "@/server/services/appointments";
import { addCarrierProduct, addChannel, createCarrier, listCarrierHistory, listProducts } from "@/server/services/carriers";
import { demoContext } from "../support/auth";
import { testPrisma } from "../support/db";

const db = testPrisma();
let staff: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
});

const t = () => randomUUID().slice(0, 8);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

async function setup() {
  const insurer = await createCarrier(staff, { legalName: `TEST A ${t()} Co`, displayName: `TEST A ${t()}`, type: "INSURER" });
  const product = (await listProducts(staff))[0];
  const cp = await addCarrierProduct(staff, insurer.id, { productId: product.id });
  const channel = await addChannel(staff, insurer.id, cp.id, { distributionType: "DIRECT" });
  const entity = (await svc.listAgencyEntities(staff))[0];
  const appt = await svc.createAppointment(staff, { agencyEntityId: entity.id, marketChannelId: channel.id, appointmentType: "Direct appointment", status: "ACTIVE", effectiveFrom: "2025-01-01" });
  return { insurer, product, channel, entity, appt };
}

describe("appointments", () => {
  it("an expired ACTIVE appointment is never shown as current, and neither are its codes", async () => {
    const s = await setup();
    await svc.addAgencyCode(staff, s.appt.id, { codeType: "MASTER", codeValue: `M-${t()}`, effectiveFrom: "2025-01-01" });
    await svc.updateAppointment(staff, s.appt.id, { effectiveTo: daysFromNow(-1) });
    const [a] = await svc.listAppointmentsForCarrier(staff, s.insurer.id);
    expect(a.status).toBe("ACTIVE");
    expect(a.state).toBe("EXPIRED");
    expect(a.codes[0].state).toBe("EXPIRED");
    const codes = await svc.listAgencyCodes(staff, { organizationId: s.insurer.id, state: "current" });
    expect(codes).toHaveLength(0);
  });

  it("warns when an appointment ends within the configured window", async () => {
    const s = await setup();
    await svc.updateAppointment(staff, s.appt.id, { effectiveTo: daysFromNow(30) });
    expect((await svc.listAppointmentsForCarrier(staff, s.insurer.id))[0].state).toBe("EXPIRING_SOON");
  });

  it("an agency entity can hold several appointments; an active one needs an effective date", async () => {
    const s = await setup();
    await svc.createAppointment(staff, { agencyEntityId: s.entity.id, marketChannelId: s.channel.id, appointmentType: "Second", status: "PENDING" });
    expect(await db.agencyAppointment.count({ where: { marketChannelId: s.channel.id } })).toBe(2);
    await expect(svc.createAppointment(staff, { agencyEntityId: s.entity.id, marketChannelId: s.channel.id, appointmentType: "x", status: "ACTIVE" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.updateAppointment(staff, s.appt.id, { effectiveTo: "2024-01-01" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("authorizations must use a product this carrier writes", async () => {
    const s = await setup();
    const tn = await db.territory.findFirstOrThrow({ where: { stateCode: "TN" } });
    await svc.addAuthorization(staff, s.appt.id, { territoryId: tn.id, productId: s.product.id, authorityType: "Quote and bind" });
    const line = await db.lineOfBusiness.findUniqueOrThrow({ where: { code: "CYBER" } });
    const other = await db.insuranceProduct.create({ data: { lineId: line.id, code: `TEST_OTHER_${t()}`, name: "TEST Other product" } });
    await expect(svc.addAuthorization(staff, s.appt.id, { territoryId: tn.id, productId: other.id, authorityType: "x" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("agency codes", () => {
  it("rejects an overlapping active duplicate with a clear message; allows re-issue after it ends", async () => {
    const s = await setup();
    const value = `P-${t()}`;
    const first = await svc.addAgencyCode(staff, s.appt.id, { codeType: "PRODUCER", codeValue: value, effectiveFrom: "2025-01-01" });
    const err = await svc.addAgencyCode(staff, s.appt.id, { codeType: "PRODUCER", codeValue: value, effectiveFrom: "2026-01-01" }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toMatch(new RegExp(`Code ${value} is already active`));
    await svc.updateAgencyCode(staff, s.appt.id, first.id, { effectiveTo: "2025-12-31" });
    await expect(svc.addAgencyCode(staff, s.appt.id, { codeType: "PRODUCER", codeValue: value, effectiveFrom: "2026-01-01" })).resolves.toBeTruthy();
    // Re-opening the old one would overlap again.
    await expect(svc.updateAgencyCode(staff, s.appt.id, first.id, { effectiveTo: "" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps a readable history of code changes, also on the carrier", async () => {
    const s = await setup();
    const admin = await db.user.findUniqueOrThrow({ where: { email: "demo.admin@example.invalid" } });
    const code = await svc.addAgencyCode(staff, s.appt.id, { codeType: "PRODUCER", codeValue: `H-${t()}`, effectiveFrom: "2025-01-01" });
    await svc.updateAgencyCode(staff, s.appt.id, code.id, { assignedUserId: admin.id });
    await svc.updateAgencyCode(staff, s.appt.id, code.id, { effectiveTo: "2026-06-30" });
    const h = await svc.listAgencyCodeHistory(staff, code.id);
    expect(h.map((e) => e.action)).toEqual(["agency_code.update", "agency_code.update", "agency_code.create"]);
    expect((h[1].beforeState as { assignedUserId: string | null }).assignedUserId).toBeNull();
    expect((h[1].afterState as { assignedUserId: string }).assignedUserId).toBe(admin.id);
    const carrierHistory = (await listCarrierHistory(staff, s.insurer.id)).map((e) => e.action);
    expect(carrierHistory).toEqual(expect.arrayContaining(["appointment.create", "agency_code.create", "agency_code.update"]));
  });

  it("requires a start date, refuses deactivated producers, and can't be reached through another appointment", async () => {
    const s = await setup();
    const other = await setup();
    await expect(svc.addAgencyCode(staff, s.appt.id, { codeType: "MASTER", codeValue: "X" })).rejects.toBeInstanceOf(ValidationError);
    const gone = await db.user.create({ data: { name: "TEST Gone", email: `gone.${t()}@example.invalid`, status: "DEACTIVATED" } });
    await expect(svc.addAgencyCode(staff, s.appt.id, { codeType: "PRODUCER", codeValue: "Y", effectiveFrom: "2026-01-01", assignedUserId: gone.id })).rejects.toBeInstanceOf(ValidationError);
    const code = await svc.addAgencyCode(staff, other.appt.id, { codeType: "MASTER", codeValue: `Z-${t()}`, effectiveFrom: "2026-01-01" });
    await expect(svc.updateAgencyCode(staff, s.appt.id, code.id, { status: "INACTIVE" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("exports CSV with formula-looking values neutralized", async () => {
    const s = await setup();
    await svc.addAgencyCode(staff, s.appt.id, { codeType: "OTHER", codeValue: "=HYPERLINK(1)", effectiveFrom: "2026-01-01", notes: 'say "hi"' });
    const csv = svc.codesCsv(await svc.listAgencyCodes(staff, { organizationId: s.insurer.id }));
    expect(csv.split("\r\n")[0]).toBe('"Carrier","Product","Channel","Agency entity","Code type","Code","Producer","Status","Effective from","Effective to","Notes"');
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    expect(csv).toContain('"say ""hi"""');
  });
});

describe("portal links", () => {
  it("stores links but refuses credentials in any field", async () => {
    const s = await setup();
    const ok = await svc.addPortal(staff, s.insurer.id, { name: "Agent portal", url: "https://portal.example.invalid/", credentialVaultReference: "Password manager › Carriers" });
    expect(ok.url).toBe("https://portal.example.invalid/");
    await expect(svc.addPortal(staff, s.insurer.id, { name: "x", url: "https://jsmith:secret@portal.example.invalid/" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addPortal(staff, s.insurer.id, { name: "x", url: "https://portal.example.invalid/", accessInstructions: "Password: hunter2" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addPortal(staff, s.insurer.id, { name: "x", url: "ftp://portal.example.invalid/" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.removePortal(staff, (await setup()).insurer.id, ok.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
