import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as filesRoute from "@/app/api/v1/files/route";
import type { AuthContext } from "@/server/auth/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import * as imp from "@/server/services/imports";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";

const db = testPrisma();
let staff: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
});

const csv = (s: string) => ({ name: "sheet.csv", bytes: new TextEncoder().encode(s) });

describe("carrier import", () => {
  it("maps columns, previews every row, commits accepted rows with an IMPORT source, and reports the rest", async () => {
    const n = randomUUID().slice(0, 6);
    const file = [
      "Carrier Name,Legal Name,Type,NAIC #,Group,Website",
      `TEST Import Alpha ${n},TEST Import Alpha ${n} Insurance Co,Insurer,8${n},DEMO Summit Mutual Group,https://alpha.example.invalid`,
      `TEST Import Beta ${n},,Wholesaler,,,`,
      `DEMO Summit Mutual,,Insurer,,,`,
      `TEST Import Alpha ${n},,Insurer,,,`,
      `,No name,Insurer,,,`,
      `TEST Import Gamma ${n},,Spaceship,,,`,
      `DEMO Summit Mutuall,,Insurer,,,`,
    ].join("\n");
    const job = await imp.uploadImport(staff, { targetType: "ORGANIZATION" }, csv(file));
    const draft = await imp.getImport(staff, job.id);
    expect(draft.job.map.columns).toMatchObject({ displayName: "Carrier Name", legalName: "Legal Name", type: "Type", naic: "NAIC #", parentName: "Group", website: "Website" });
    await expect(imp.commitImport(staff, job.id)).rejects.toBeInstanceOf(ConflictError); // preview first

    const { preview } = await imp.saveMapping(staff, job.id, { columns: draft.job.map.columns });
    expect(preview.map((p) => [p.row, p.action])).toEqual([
      [2, "CREATE"], [3, "CREATE"], [4, "DUPLICATE"], [5, "DUPLICATE"], [6, "ERROR"], [7, "ERROR"], [8, "POSSIBLE_DUPLICATE"],
    ]);
    const done = await imp.commitImport(staff, job.id);
    expect(done).toMatchObject({ status: "COMMITTED", acceptedRows: 2, rejectedRows: 5 });

    const alpha = await db.organization.findFirstOrThrow({ where: { displayName: `TEST Import Alpha ${n}` }, include: { identifiers: true, parent: true } });
    expect(alpha.parent?.displayName).toBe("DEMO Summit Mutual Group");
    expect(alpha.identifiers[0]).toMatchObject({ type: "NAIC", value: `8${n}` });
    const src = await db.recordSource.findFirstOrThrow({ where: { recordType: "ORGANIZATION", recordId: alpha.id } });
    expect(src).toMatchObject({ sourceKind: "IMPORT", importJobId: job.id, pageOrSection: "row 2" });
    expect(await db.auditEvent.count({ where: { entityId: alpha.id, action: "import.create" } })).toBe(1);
    expect(await db.organization.count({ where: { displayName: "DEMO Summit Mutuall" } })).toBe(0); // possible duplicate skipped

    const url = await imp.errorReportUrl(staff, job.id);
    const report = await (await filesRoute.GET(new Request(`http://localhost${url}`))).text();
    expect(report.split("\r\n").filter(Boolean)).toHaveLength(6); // header + 5 rejected rows
    expect(report).toContain("Spaceship");
    await expect(imp.commitImport(staff, job.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("imports the carrier portal site from a Portal column, refusing addresses with a login in them", async () => {
    const n = randomUUID().slice(0, 6);
    const file = [`Carrier,Portal`, `TEST Portal Ok ${n},https://agents.example.invalid/login`, `TEST Portal Bad ${n},https://jsmith:pw@agents.example.invalid/`].join("\n");
    const job = await imp.uploadImport(staff, { targetType: "ORGANIZATION" }, csv(file));
    const draft = await imp.getImport(staff, job.id);
    expect(draft.job.map.columns).toMatchObject({ displayName: "Carrier", portalUrl: "Portal" });
    const { preview } = await imp.saveMapping(staff, job.id, { columns: draft.job.map.columns });
    expect(preview.map((p) => p.action)).toEqual(["CREATE", "ERROR"]);
    expect(preview[1].messages.join(" ")).toMatch(/must not contain a username or password/);
    await imp.commitImport(staff, job.id);
    expect((await db.organization.findFirstOrThrow({ where: { displayName: `TEST Portal Ok ${n}` } })).portalUrl).toBe("https://agents.example.invalid/login");
  });

  it("creates possible duplicates only when asked", async () => {
    const job = await imp.uploadImport(staff, { targetType: "ORGANIZATION" }, csv(`Name\nDEMO Ridgeline Specialtyy ${randomUUID().slice(0, 2)}\n`));
    const { preview } = await imp.saveMapping(staff, job.id, { columns: { displayName: "Name" }, createPossibleDuplicates: "on" });
    expect(preview[0].action).toBe("POSSIBLE_DUPLICATE");
    expect((await imp.commitImport(staff, job.id)).acceptedRows).toBe(1);
  });

  it("validates the file and the mapping", async () => {
    await expect(imp.uploadImport(staff, { targetType: "ORGANIZATION" }, { name: "x.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n%%EOF") })).rejects.toThrow(/Upload a .csv file/);
    await expect(imp.uploadImport(staff, { targetType: "ORGANIZATION" }, csv("Name\n"))).rejects.toThrow(/at least one data row/);
    await expect(imp.uploadImport(staff, { targetType: "ORGANIZATION" }, csv("Name,name\na,b\n"))).rejects.toThrow(/same header/);
    await expect(imp.uploadImport(staff, { targetType: "APPETITE" }, csv("a\nb\n"))).rejects.toBeInstanceOf(ValidationError);
    const job = await imp.uploadImport(staff, { targetType: "ORGANIZATION" }, csv("Foo,Bar\n1,2\n"));
    await expect(imp.saveMapping(staff, job.id, { columns: { legalName: "Foo" } })).rejects.toThrow(/Display name/);
    await expect(imp.saveMapping(staff, job.id, { columns: { displayName: "Foo", legalName: "Foo" } })).rejects.toThrow(/mapped to two fields/);
    await expect(imp.saveMapping(staff, job.id, { columns: { displayName: "Nope" } })).rejects.toThrow(/isn't in the file/);
  });

  it("needs import.run", async () => {
    const nobody = await limitedUser(db, ["carrier.read"]);
    await expect(imp.uploadImport(nobody, { targetType: "ORGANIZATION" }, csv("Name\nX\n"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(imp.listImports(nobody)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("contact import", () => {
  it("creates contacts with a carrier assignment and territory; skips known emails", async () => {
    const n = randomUUID().slice(0, 6);
    const file = [
      "First,Last,Email,Carrier,Role,State,Title",
      `Pat,Import${n},pat.${n}@example.invalid,DEMO Summit Mutual,Underwriter,Tennessee,Senior UW`,
      `Lee,Import${n},,DEMO Summit Mutual,Marketing rep,US,`,
      `Sam,Import${n},demo.uw@example.invalid,,,,`,
      `Kim,Import${n},kim@example.invalid,Unknown Carrier,,,`,
      `Ray,Import${n},ray.${n}@example.invalid,,,TN,`,
    ].join("\n");
    const job = await imp.uploadImport(staff, { targetType: "CONTACT" }, csv(file));
    const g = await imp.getImport(staff, job.id);
    const { preview } = await imp.saveMapping(staff, job.id, { columns: g.job.map.columns });
    expect(preview.map((p) => p.action)).toEqual(["CREATE", "CREATE", "DUPLICATE", "ERROR", "ERROR"]);
    await imp.commitImport(staff, job.id);
    const pat = await db.contact.findFirstOrThrow({ where: { lastName: `Import${n}`, firstName: "Pat" }, include: { assignments: { include: { territory: true, organization: true } } } });
    expect(pat.assignments[0]).toMatchObject({ role: "UNDERWRITER", title: "Senior UW" });
    expect(pat.assignments[0].territory?.stateCode).toBe("TN");
    const lee = await db.contact.findFirstOrThrow({ where: { lastName: `Import${n}`, firstName: "Lee" }, include: { assignments: { include: { territory: true } } } });
    expect(lee.assignments[0].territory?.territoryType).toBe("COUNTRY");
  });
});
