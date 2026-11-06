import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import * as svc from "@/server/services/appointments";
import { addCarrierProduct, addChannel, createCarrier, listCarrierHistory, listProducts } from "@/server/services/carriers";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";

/** Agency codes and portal links as a reference (appointments are managed by corporate, DECISIONS N19). */
const db = testPrisma();
let staff: AuthContext;
let entityId: string;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  entityId = (await db.agencyEntity.findFirstOrThrow({ where: { organization: { displayName: "DEMO Agency Entity" } } })).id;
  // A second entity, so the app has to be told which one a code belongs to.
  const org = await db.organization.create({ data: { legalName: `TEST Second Agency ${t()}`, displayName: `TEST Second Agency ${t()}`, type: "AGENCY" } });
  await db.agencyEntity.create({ data: { organizationId: org.id } });
});

const t = () => randomUUID().slice(0, 8);

async function setup() {
  const insurer = await createCarrier(staff, { legalName: `TEST C ${t()} Co`, displayName: `TEST C ${t()}`, type: "INSURER" });
  const product = (await listProducts(staff))[0];
  const cp = await addCarrierProduct(staff, insurer.id, { productId: product.id });
  const channel = await addChannel(staff, insurer.id, cp.id, { distributionType: "DIRECT" });
  return { insurer, product, channel };
}

describe("agency codes", () => {
  it("adds a code to a channel without any appointment details, and lists it on the carrier", async () => {
    const s = await setup();
    const code = await svc.addAgencyCode(staff, { agencyEntityId: entityId, marketChannelId: s.channel.id, codeType: "MASTER", codeValue: `M-${t()}` });
    const [listed] = await svc.listCodesForCarrier(staff, s.insurer.id);
    expect(listed.id).toBe(code.id);
    expect(listed.inUse).toBe(true);
    // One grouping row per channel and entity, reused for the next code.
    await svc.addAgencyCode(staff, { agencyEntityId: entityId, marketChannelId: s.channel.id, codeType: "PRODUCER", codeValue: `P-${t()}` });
    expect(await db.agencyAppointment.count({ where: { marketChannelId: s.channel.id } })).toBe(1);
    expect((await svc.listAgencyCodes(staff, { organizationId: s.insurer.id, state: "active" })).length).toBe(2);
  });

  it("refuses an active duplicate with a clear message; allows it again once the old one is not in use", async () => {
    const s = await setup();
    const value = `D-${t()}`;
    const first = await svc.addAgencyCode(staff, { agencyEntityId: entityId, marketChannelId: s.channel.id, codeType: "PRODUCER", codeValue: value });
    const err = await svc.addAgencyCode(staff, { agencyEntityId: entityId, marketChannelId: s.channel.id, codeType: "PRODUCER", codeValue: value }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toMatch(new RegExp(`Code ${value} is already active`));
    await svc.updateAgencyCode(staff, first.id, { status: "INACTIVE" });
    await expect(svc.addAgencyCode(staff, { agencyEntityId: entityId, marketChannelId: s.channel.id, codeType: "PRODUCER", codeValue: value })).resolves.toBeTruthy();
    // Putting the old one back in use would duplicate it.
    await expect(svc.updateAgencyCode(staff, first.id, { status: "ACTIVE" })).rejects.toBeInstanceOf(ConflictError);
    const inactive = await svc.listAgencyCodes(staff, { organizationId: s.insurer.id, state: "inactive" });
    expect(inactive.map((c) => c.id)).toEqual([first.id]);
  });

  it("keeps a readable history of code changes, also on the carrier", async () => {
    const s = await setup();
    const admin = await db.user.findUniqueOrThrow({ where: { email: "demo.admin@example.invalid" } });
    const code = await svc.addAgencyCode(staff, { agencyEntityId: entityId, marketChannelId: s.channel.id, codeType: "PRODUCER", codeValue: `H-${t()}` });
    await svc.updateAgencyCode(staff, code.id, { assignedUserId: admin.id });
    const h = await db.auditEvent.findMany({ where: { entityId: code.id }, orderBy: { occurredAt: "asc" } });
    expect(h.map((e) => e.action)).toEqual(["agency_code.create", "agency_code.update"]);
    expect((h[1].beforeState as { assignedUserId: string | null }).assignedUserId).toBeNull();
    expect((h[1].afterState as { assignedUserId: string }).assignedUserId).toBe(admin.id);
    const carrierHistory = (await listCarrierHistory(staff, s.insurer.id)).map((e) => e.action);
    expect(carrierHistory).toEqual(expect.arrayContaining(["agency_code.create", "agency_code.update"]));
  });

  it("checks the channel, entity and producer; unknown codes are not found", async () => {
    const s = await setup();
    await expect(svc.addAgencyCode(staff, { codeType: "MASTER", codeValue: "X" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addAgencyCode(staff, { agencyEntityId: entityId, marketChannelId: randomUUID(), codeType: "MASTER", codeValue: "X" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.addAgencyCode(staff, { marketChannelId: s.channel.id, agencyEntityId: randomUUID(), codeType: "MASTER", codeValue: "X" })).rejects.toThrow(/agency entity/);
    // With more than one agency entity, the app must be told which one.
    await expect(svc.addAgencyCode(staff, { marketChannelId: s.channel.id, codeType: "MASTER", codeValue: "X" })).rejects.toThrow(/Choose which agency entity/);
    const gone = await db.user.create({ data: { name: "TEST Gone", email: `gone.${t()}@example.invalid`, status: "DEACTIVATED" } });
    await expect(svc.addAgencyCode(staff, { agencyEntityId: entityId, marketChannelId: s.channel.id, codeType: "PRODUCER", codeValue: "Y", assignedUserId: gone.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.updateAgencyCode(staff, randomUUID(), { status: "INACTIVE" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.updateAgencyCode(staff, "not-an-id", { status: "INACTIVE" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("needs appointment.write to add and appointment.read to list", async () => {
    const s = await setup();
    const reader = await limitedUser(db, ["appointment.read", "carrier.read"]);
    await expect(svc.addAgencyCode(reader, { agencyEntityId: entityId, marketChannelId: s.channel.id, codeType: "MASTER", codeValue: "R" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await svc.listCodesForCarrier(reader, s.insurer.id)).toEqual([]);
    const none = await limitedUser(db, ["carrier.read"]);
    await expect(svc.listCodesForCarrier(none, s.insurer.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("exports CSV with formula-looking values neutralized", async () => {
    const s = await setup();
    await svc.addAgencyCode(staff, { agencyEntityId: entityId, marketChannelId: s.channel.id, codeType: "OTHER", codeValue: "=HYPERLINK(1)", notes: 'say "hi"' });
    const csv = svc.codesCsv(await svc.listAgencyCodes(staff, { organizationId: s.insurer.id }));
    expect(csv.split("\r\n")[0]).toBe('"Carrier","Product","Channel","Agency entity","Code type","Code","Producer","In use","Notes"');
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"Yes"');
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
