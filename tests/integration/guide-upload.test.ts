import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/server/auth/context";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { createCarrier } from "@/server/services/carriers";
import * as docs from "@/server/services/documents";
import { queueExtraction, runQueuedExtraction } from "@/server/services/extractions";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";

/** Guides uploaded on the Appetite tab: the name comes from the document; the AI read can start right away (Josh, 2026-11-16). */
const db = testPrisma();
let staff: AuthContext;
const prevDriver = process.env.AI_DRIVER;
afterAll(async () => {
  if (prevDriver === undefined) delete process.env.AI_DRIVER;
  else process.env.AI_DRIVER = prevDriver;
  await db.$disconnect();
});
beforeAll(async () => {
  process.env.AI_DRIVER = "dev";
  staff = await demoContext(db, "demo.producer@example.invalid");
});
const t = () => randomUUID().slice(0, 6);

/** A real PDF with a large heading and small body text; optionally its own Title. */
async function guidePdf(o: { metaTitle?: string; heading: string[]; body: string }) {
  const doc = await PDFDocument.create();
  if (o.metaTitle) doc.setTitle(o.metaTitle);
  else doc.setTitle(""); // no usable title of its own
  doc.setSubject(`TEST ${Math.random()}`); // unique bytes per file
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  o.heading.forEach((line, i) => page.drawText(line, { x: 50, y: 720 - i * 30, size: 24, font }));
  page.drawText(o.body, { x: 50, y: 600, size: 10, font });
  return doc.save();
}

async function carrierWithLine() {
  const n = t();
  const carrier = await createCarrier(staff, { legalName: `TEST Upload ${n} Co`, displayName: `TEST Upload ${n}`, type: "INSURER" });
  const line = await db.lineOfBusiness.findUniqueOrThrow({ where: { code: "PERSONAL_HOME" } });
  const product = await db.insuranceProduct.create({ data: { lineId: line.id, code: `TEST_UP_${n}`, name: `TEST Homeowners ${n}` } });
  const cp = await db.carrierProduct.create({ data: { writingCompanyId: carrier.id, productId: product.id } });
  return { carrier, cp };
}

describe("a document's name read from the file", () => {
  it("uses the PDF's own title when it is a real one", async () => {
    const { carrier } = await carrierWithLine();
    const bytes = await guidePdf({ metaTitle: `${carrier.displayName} Homeowners Manual`, heading: ["Something Else"], body: "Body." });
    const r = await docs.uploadDocument(staff, { documentType: "UNDERWRITING_GUIDELINES", organizationId: carrier.id }, { name: "tnh_pg.pdf", bytes });
    expect(r.document.title).toBe(`${carrier.displayName} Homeowners Manual`);
  });

  it("otherwise uses the page-1 heading, with the carrier in front when the heading doesn't name it", async () => {
    const { carrier } = await carrierWithLine();
    const bytes = await guidePdf({ heading: ["Homeowners", "Product Guide"], body: "Wood shake roofs are ineligible." });
    const r = await docs.uploadDocument(staff, { documentType: "UNDERWRITING_GUIDELINES", organizationId: carrier.id }, { name: "tnh_pg.pdf", bytes });
    expect(r.document.title).toBe(`${carrier.displayName} – Homeowners Product Guide`);
  });

  it("a typed title still wins, and non-PDFs use the tidied file name", async () => {
    const { carrier } = await carrierWithLine();
    const bytes = await guidePdf({ heading: ["Product Guide"], body: "x" });
    const typed = await docs.uploadDocument(staff, { title: "TEST My name", documentType: "UNDERWRITING_GUIDELINES", organizationId: carrier.id }, { name: "g.pdf", bytes });
    expect(typed.document.title).toBe("TEST My name");
    const csv = await docs.uploadDocument(staff, { documentType: "OTHER" }, { name: `TEST_rate_sheet_${t()}.csv`, bytes: new TextEncoder().encode("a,b\n1,2\n") });
    expect(csv.document.title).toMatch(/^TEST rate sheet /);
  });
});

describe("starting the AI read right after upload", () => {
  it("queues a read of the new guide for the chosen product, which then becomes ready for review", async () => {
    const { carrier, cp } = await carrierWithLine();
    const bytes = await guidePdf({ heading: ["Homeowners Guide"], body: "RULE: PROHIBITED |  | p1 | Vacant dwellings are ineligible." });
    const up = await docs.uploadDocument(staff, { documentType: "UNDERWRITING_GUIDELINES", organizationId: carrier.id }, { name: "g.pdf", bytes });
    const id = await queueExtraction(staff, { documentVersionId: up.version.id, carrierProductId: cp.id });
    expect((await db.guideExtraction.findUniqueOrThrow({ where: { id } })).status).toBe("RUNNING");
    await runQueuedExtraction(staff, id);
    expect((await db.guideExtraction.findUniqueOrThrow({ where: { id } })).status).toBe("READY");
  });

  it("refuses another carrier's product, a restricted document, and people without appetite.write", async () => {
    const a = await carrierWithLine();
    const b = await carrierWithLine();
    const bytes = await guidePdf({ heading: ["Homeowners Guide"], body: "x" });
    const up = await docs.uploadDocument(staff, { documentType: "UNDERWRITING_GUIDELINES", organizationId: a.carrier.id }, { name: "g.pdf", bytes });
    await expect(queueExtraction(staff, { documentVersionId: up.version.id, carrierProductId: b.cp.id })).rejects.toThrow(/different carrier/);
    const reader = await limitedUser(db, ["appetite.read", "document.read", "document.write"]);
    await expect(queueExtraction(reader, { documentVersionId: up.version.id, carrierProductId: a.cp.id })).rejects.toBeInstanceOf(ForbiddenError);
    await db.document.update({ where: { id: up.document.id }, data: { classification: "RESTRICTED" } });
    await expect(queueExtraction(staff, { documentVersionId: up.version.id, carrierProductId: a.cp.id })).rejects.toBeInstanceOf(ValidationError);
  });
});
