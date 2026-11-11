import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { addAgencyCodes } from "@/server/services/appointments";
import { addCarrierProduct, createCarrier, listProducts, updateCarrier } from "@/server/services/carriers";
import { addContactToCarrier } from "@/server/services/contacts";
import { carrierSnapshot } from "@/server/services/snapshot";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";

/** The Dashboard's Carrier SnapShot (Josh, 2026-11-11). */
const db = testPrisma();
let staff: AuthContext;
let entityId: string;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  entityId = (await db.agencyEntity.findFirstOrThrow({ where: { organization: { displayName: "DEMO Agency Entity" } } })).id;
});
const t = () => randomUUID().slice(0, 8);

describe("Carrier SnapShot", () => {
  it("shows the carrier's phones, its active marketing reps, and in-use codes grouped by value with their lines", async () => {
    const c = await createCarrier(staff, { legalName: `TEST Snap ${t()} Co`, displayName: `TEST Snap ${t()}`, type: "INSURER", mainPhone: "800-555-0100" });
    await updateCarrier(staff, c.id, { billingPhone: "800-555-0101", claimsPhone: "800-555-0102" });
    const rep = await addContactToCarrier(staff, c.id, { role: "MARKETING_REP", firstName: "TEST", lastName: `Rep ${t()}`, email: `rep.${t()}@example.invalid`, officePhone: "865-555-0110" });
    await addContactToCarrier(staff, c.id, { role: "CLAIMS_ADJUSTER", firstName: "TEST", lastName: `Adjuster ${t()}` });
    const p1 = await db.insuranceProduct.findFirstOrThrow({ where: { id: (await listProducts(staff))[0].id } });
    const p2 = await db.insuranceProduct.create({ data: { lineId: p1.lineId, code: `TEST_SNAP_${t()}`, name: `TEST Snap line ${t()}` } });
    await addCarrierProduct(staff, c.id, { productId: p1.id });
    await addCarrierProduct(staff, c.id, { productId: p2.id });
    const value = `SNAP-${t()}`;
    await addAgencyCodes(staff, c.id, { targets: ["all"], agencyEntityId: entityId, codeType: "MASTER", codeValue: value });

    const s = await carrierSnapshot(staff, c.id);
    expect(s.phones).toEqual({ main: "800-555-0100", billing: "800-555-0101", claims: "800-555-0102" });
    expect(s.reps).toEqual([{ contactId: rep.contact.id, name: `TEST ${rep.contact.lastName}`, email: rep.contact.email, phone: "865-555-0110" }]);
    expect(s.codes).toEqual([{ value, type: "MASTER", lines: expect.arrayContaining([p1.name, p2.name]), producer: null }]);
    expect(s.codes![0].lines).toHaveLength(2);

    // A blank phone clears it; missing data is shown as missing, never invented.
    await updateCarrier(staff, c.id, { claimsPhone: "" });
    expect((await carrierSnapshot(staff, c.id)).phones.claims).toBeNull();
  });

  it("leaves out sections the person can't see, and needs carrier.read", async () => {
    const c = await createCarrier(staff, { legalName: `TEST Snap ${t()} Co`, displayName: `TEST Snap ${t()}`, type: "INSURER" });
    const carrierOnly = await limitedUser(db, ["carrier.read"]);
    const s = await carrierSnapshot(carrierOnly, c.id);
    expect([s.reps, s.codes]).toEqual([null, null]);
    await expect(carrierSnapshot(await limitedUser(db, ["contact.read"]), c.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(carrierSnapshot(staff, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(carrierSnapshot(staff, "not-an-id")).rejects.toBeInstanceOf(NotFoundError);
  });
});
