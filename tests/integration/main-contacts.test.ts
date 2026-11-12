import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { createCarrier, updateCarrier } from "@/server/services/carriers";
import { addContactToCarrier, endAssignment, mainContacts, setContactArchived, updateContact } from "@/server/services/contacts";
import { isDialable } from "@/lib/contact-roles";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";

/** "Main contacts" on the Contacts page and the carrier's Contacts tab (Josh, 2026-11-12). */
const db = testPrisma();
let staff: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
});
const t = () => randomUUID().slice(0, 8);
const carrier = () => createCarrier(staff, { legalName: `TEST Main ${t()} Co`, displayName: `TEST Main ${t()}`, type: "INSURER" });
const person = (role: string, last: string, extra: Record<string, string> = {}) => ({ role, firstName: "TEST", lastName: `${last} ${t()}`, ...extra });

describe("main contacts", () => {
  it("groups current, active contacts into marketing rep, claims and billing, with the carrier's own lines", async () => {
    const c = await carrier();
    await updateCarrier(staff, c.id, { claimsPhone: "800-555-0102", billingPhone: "See CL/PL" });
    const rep = await addContactToCarrier(staff, c.id, person("MARKETING_REP", "Rep", { email: `rep.${t()}@example.invalid`, officePhone: "865-555-0110" }));
    const adjuster = await addContactToCarrier(staff, c.id, person("CLAIMS_ADJUSTER", "Adjuster"));
    const manager = await addContactToCarrier(staff, c.id, person("CLAIMS_MANAGER", "Manager"));
    const billing = await addContactToCarrier(staff, c.id, person("BILLING", "Billing"));
    await addContactToCarrier(staff, c.id, person("PL_UNDERWRITER", "Underwriter")); // not a main contact

    const m = await mainContacts(staff, c.id);
    expect(m.carrier).toEqual({ id: c.id, name: c.displayName });
    expect(m.groups.map((g) => g.key)).toEqual(["marketing", "claims", "billing"]);
    const [mkt, claims, bill] = m.groups;
    expect(mkt.contacts.map((x) => x.contactId)).toEqual([rep.contact.id]);
    expect(mkt.contacts[0]).toMatchObject({ email: rep.contact.email, officePhone: "865-555-0110", role: "MARKETING_REP" });
    expect(claims.contacts.map((x) => x.contactId).sort()).toEqual([adjuster.contact.id, manager.contact.id].sort());
    expect(bill.contacts.map((x) => x.contactId)).toEqual([billing.contact.id]);
    expect([mkt.line, claims.line, bill.line]).toEqual([null, "800-555-0102", "See CL/PL"]);
  });

  it("always returns every group, so an empty one can say nothing is on file", async () => {
    const c = await carrier();
    await addContactToCarrier(staff, c.id, person("MARKETING_REP", "Rep"));
    const m = await mainContacts(staff, c.id);
    expect(m.groups.map((g) => [g.key, g.contacts.length, g.empty])).toEqual([
      ["marketing", 1, "No marketing rep on file"],
      ["claims", 0, "No claims contact on file"],
      ["billing", 0, "No billing contact on file"],
    ]);
  });

  it("leaves out ended assignments, inactive or archived contacts, and other carriers' contacts", async () => {
    const c = await carrier();
    const other = await carrier();
    const ended = await addContactToCarrier(staff, c.id, person("MARKETING_REP", "Ended"));
    await endAssignment(staff, ended.contact.id, ended.assignment.id, { effectiveTo: "2026-01-01" });
    const inactive = await addContactToCarrier(staff, c.id, person("CLAIMS_ADJUSTER", "Inactive"));
    await updateContact(staff, inactive.contact.id, { status: "INACTIVE" });
    const archived = await addContactToCarrier(staff, c.id, person("BILLING", "Archived"));
    await setContactArchived(staff, archived.contact.id, true);
    await addContactToCarrier(staff, other.id, person("MARKETING_REP", "Elsewhere"));
    const m = await mainContacts(staff, c.id);
    expect(m.groups.every((g) => g.contacts.length === 0)).toBe(true);
  });

  it("needs contact.read, and refuses an unknown carrier or an agency", async () => {
    const c = await carrier();
    await expect(mainContacts(await limitedUser(db, ["carrier.read"]), c.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(mainContacts(staff, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(mainContacts(staff, "not-an-id")).rejects.toBeInstanceOf(NotFoundError);
    const agency = await db.organization.findFirstOrThrow({ where: { type: "AGENCY" } });
    await expect(mainContacts(staff, agency.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("phone numbers that can be dialed", () => {
  it("treats 7+ digits as a number and anything else as a note", () => {
    expect(isDialable("800-238-6225")).toBe(true);
    expect(isDialable("(865) 555-0110 ext 4")).toBe(true);
    expect(isDialable("See CL/PL")).toBe(false);
    expect(isDialable("ext 1234")).toBe(false);
    expect(isDialable(null)).toBe(false);
  });
});
