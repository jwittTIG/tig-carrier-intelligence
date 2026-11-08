import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as filesRoute from "@/app/api/v1/files/route";
import type { AuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createCarrier } from "@/server/services/carriers";
import * as docs from "@/server/services/documents";
import * as guides from "@/server/services/guides";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";

/** Ask the guides (M8) with the development reader: no real AI calls, no cost. */
const db = testPrisma();
let staff: AuthContext;
afterAll(() => db.$disconnect());
const prevDriver = process.env.AI_DRIVER;
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  process.env.AI_DRIVER = "dev";
});
afterEach(() => {
  process.env.AI_DRIVER = "dev";
});
afterAll(() => {
  if (prevDriver === undefined) delete process.env.AI_DRIVER;
  else process.env.AI_DRIVER = prevDriver;
});

const t = () => randomUUID().slice(0, 6);
const pdf = (lines: string[]) => new TextEncoder().encode(`%PDF-1.4\n${lines.map((l) => `% ${l}`).join("\n")}\n% ${Math.random()}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);

async function carrierWithGuide(lines: string[], o: { documentType?: string; classification?: string } = {}) {
  const name = `TEST Guides ${t()}`;
  const carrier = await createCarrier(staff, { legalName: `${name} Insurance Co`, displayName: name, type: "INSURER" });
  const guide = await docs.uploadDocument(staff, { title: `${name} homeowners guide`, documentType: o.documentType ?? "UNDERWRITING_GUIDELINES", classification: o.classification ?? "INTERNAL", organizationId: carrier.id }, { name: "guide.pdf", bytes: pdf(lines) });
  return { carrier, guide };
}

describe("asking a carrier's guides", () => {
  it("answers from the carrier named in the question, cites the guide and page, and logs it", async () => {
    const { carrier, guide } = await carrierWithGuide(["Roof requirements", "Wood shake roofs are prohibited on all dwellings."]);
    const r = await guides.askGuides(staff, { question: `Will ${carrier.displayName} write a home with a wood shake roof?` });
    expect(r.carrier.id).toBe(carrier.id);
    expect(r.status).toBe("ANSWERED");
    expect(r.verdict).toBe("NO");
    expect(r.citations).toEqual([{ documentVersionId: guide.version.id, documentId: guide.document.id, title: guide.document.title, versionNumber: 1, startPage: 1, endPage: 1, quote: "Wood shake roofs are prohibited on all dwellings." }]);
    expect(r.documentVersionIds).toEqual([guide.version.id]);
    expect(r.promptVersion).toBe("ask-guides-v1");
    expect(await db.auditEvent.count({ where: { entityId: r.id, action: "guides.ask" } })).toBe(1);
    const back = await guides.getQuestion(staff, r.id);
    expect(back.citations[0].quote).toMatch(/Wood shake/);
    expect((await guides.listRecentQuestions(staff, { organizationId: carrier.id })).map((q) => q.id)).toEqual([r.id]);
  });

  it("says when the guide doesn't address it, never yes", async () => {
    const { carrier } = await carrierWithGuide(["Frame construction is acceptable."]);
    const r = await guides.askGuides(staff, { question: "Do they take trampolines?", organizationId: carrier.id });
    expect(r.verdict).toBe("NOT_ADDRESSED");
    expect(r.citations).toEqual([]);
  });

  it("reads only active, non-restricted guides filed under the carrier, latest version", async () => {
    const { carrier, guide } = await carrierWithGuide(["Old: wood shake roofs acceptable."]);
    await docs.uploadVersion(staff, guide.document.id, { name: "guide-v2.pdf", bytes: pdf(["New: wood shake roofs refer to underwriting."]) });
    await docs.uploadDocument(staff, { title: "TEST Restricted agreement", documentType: "UNDERWRITING_GUIDELINES", classification: "RESTRICTED", organizationId: carrier.id }, { name: "r.pdf", bytes: pdf(["secret"]) });
    await docs.uploadDocument(staff, { title: "TEST Bulletin", documentType: "BULLETIN", organizationId: carrier.id }, { name: "b.pdf", bytes: pdf(["bulletin"]) });
    const list = await guides.listGuides(staff, carrier.id);
    expect(list.map((g) => [g.title, g.versionNumber])).toEqual([[guide.document.title, 2]]);
    const r = await guides.askGuides(staff, { question: "wood shake?", organizationId: carrier.id });
    expect(r.verdict).toBe("REFER");
    expect(r.citations[0].versionNumber).toBe(2);
  });

  it("explains what's missing: carrier, guides, or AI set-up", async () => {
    await expect(guides.askGuides(staff, { question: "Who writes wood shake roofs?" })).rejects.toThrow(/Which carrier\?/);
    await expect(guides.askGuides(staff, { question: "x?", organizationId: randomUUID() })).rejects.toBeInstanceOf(ValidationError);
    await expect(guides.askGuides(staff, { question: "wood shake roofs?", organizationId: randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
    const bare = await createCarrier(staff, { legalName: `TEST NoGuide ${t()} Co`, displayName: `TEST NoGuide ${t()}`, type: "INSURER" });
    await expect(guides.askGuides(staff, { question: "wood shake roofs?", organizationId: bare.id })).rejects.toThrow(/no PDF appetite guide/);
    const { carrier } = await carrierWithGuide(["Wood shake roofs are prohibited."]);
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_DRIVER = "";
    try {
      expect(guides.aiStatus().mode).toBe("off");
      await expect(guides.askGuides(staff, { question: "wood shake roofs?", organizationId: carrier.id })).rejects.toThrow(/AI isn't set up yet/);
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  it("logs a failed read instead of losing the question", async () => {
    const { carrier, guide } = await carrierWithGuide(["Wood shake roofs are prohibited."]);
    // Break the stored file so the reader fails.
    await db.documentVersion.update({ where: { id: guide.version.id }, data: { objectKey: `documents/missing/${randomUUID()}` } });
    const r = await guides.askGuides(staff, { question: "wood shake roofs?", organizationId: carrier.id });
    expect(r.status).toBe("FAILED");
    expect(r.error).toBeTruthy();
    expect(r.verdict).toBeNull();
  });

  it("needs guides.ask and document.read", async () => {
    const { carrier } = await carrierWithGuide(["Wood shake roofs are prohibited."]);
    const noAsk = await limitedUser(db, ["document.read", "carrier.read"]);
    await expect(guides.askGuides(noAsk, { question: "wood shake roofs?", organizationId: carrier.id })).rejects.toBeInstanceOf(ForbiddenError);
    const noDocs = await limitedUser(db, ["guides.ask", "carrier.read"]);
    await expect(guides.askGuides(noDocs, { question: "wood shake roofs?", organizationId: carrier.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(guides.listRecentQuestions(noAsk)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the database keeps verdicts to the fixed list and answered rows complete", async () => {
    const { carrier } = await carrierWithGuide(["x"]);
    const base = { askedById: staff.userId, organizationId: carrier.id, question: "TEST q?", model: "x", promptVersion: "x" };
    await expect(db.guideQuestion.create({ data: { ...base, status: "ANSWERED", verdict: "MAYBE", answerText: "x" } })).rejects.toThrow();
    await expect(db.guideQuestion.create({ data: { ...base, status: "ANSWERED", verdict: "YES" } })).rejects.toThrow();
  });
});

describe("opening a cited PDF page", () => {
  it("view=1 opens a PDF in the browser; everything else still downloads", async () => {
    const { guide } = await carrierWithGuide(["Wood shake roofs are prohibited."]);
    const open = async (view: boolean) => {
      const url = await docs.downloadUrl(staff, guide.version.id, { view });
      const res = await filesRoute.GET(new Request(`http://localhost${url}`));
      return res.headers.get("content-disposition") ?? "";
    };
    expect(await open(true)).toMatch(/^inline;/);
    expect(await open(false)).toMatch(/^attachment;/);
  });
});
