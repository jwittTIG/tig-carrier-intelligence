import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as filesRoute from "@/app/api/v1/files/route";
import type { AuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import * as docs from "@/server/services/documents";
import { addSource, listSources } from "@/server/services/sources";
import { verifyToken } from "@/server/storage";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";

const db = testPrisma();
let staff: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
});

const pdf = (text = "TEST appetite guide") => new TextEncoder().encode(`%PDF-1.4\n% ${text} ${Math.random()}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
const upload = (o: Record<string, unknown> = {}, file = { name: "guide.pdf", bytes: pdf() }) =>
  docs.uploadDocument(staff, { title: "TEST Guide", documentType: "APPETITE_GUIDE", ...o }, file);

describe("uploads", () => {
  it("stores a PDF privately as version 1 and audits it", async () => {
    const { document, version } = await upload();
    expect(version.versionNumber).toBe(1);
    expect(version.mimeType).toBe("application/pdf");
    expect(version.objectKey).toMatch(/^documents\/\d{4}-\d{2}\/[0-9a-f-]{36}$/);
    expect(version.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await db.auditEvent.count({ where: { entityId: document.id, action: "document.upload" } })).toBe(1);
  });

  it("checks type by content: rejects a renamed file, unknown binaries, empty files and the EICAR test string", async () => {
    await expect(upload({}, { name: "guide.pdf", bytes: new TextEncoder().encode("just text") })).rejects.toBeInstanceOf(ValidationError);
    await expect(upload({}, { name: "guide.docx", bytes: pdf() })).rejects.toThrow(/content is PDF/);
    await expect(upload({}, { name: "x.exe", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 3, 0, 0, 0]) })).rejects.toBeInstanceOf(ValidationError);
    await expect(upload({}, { name: "empty.pdf", bytes: new Uint8Array() })).rejects.toThrow(/empty/);
    const eicar = new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    await expect(upload({}, { name: "eicar.txt", bytes: eicar })).rejects.toThrow(/malware scan/);
    await expect(upload({}, { name: "rates.csv", bytes: new TextEncoder().encode("a,b\n1,2\n") })).resolves.toBeTruthy();
  });

  it("enforces the size limit from settings", async () => {
    await db.appSetting.update({ where: { key: "document.max_upload_mb" }, data: { value: 0.0001 } });
    try {
      await expect(upload({}, { name: "big.pdf", bytes: new Uint8Array([...pdf(), ...new Uint8Array(500)]) })).rejects.toThrow(/larger than/);
    } finally {
      await db.appSetting.update({ where: { key: "document.max_upload_mb" }, data: { value: 25 } });
    }
  });

  it("adds versions, flags duplicates by content, and links to a carrier", async () => {
    const carrier = await db.organization.findFirstOrThrow({ where: { displayName: "DEMO Summit Mutual" } });
    const same = pdf("identical");
    const a = await upload({ organizationId: carrier.id }, { name: "a.pdf", bytes: same });
    const v2 = await docs.uploadVersion(staff, a.document.id, { name: "a2.pdf", bytes: pdf("v2") });
    expect(v2.versionNumber).toBe(2);
    const b = await upload({ title: "TEST Copy" }, { name: "b.pdf", bytes: same });
    const full = await docs.getDocument(staff, a.document.id);
    expect(full.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(full.duplicates.map((d) => d.document.id)).toContain(b.document.id);
    expect((await docs.listDocuments(staff, { organizationId: carrier.id })).map((d) => d.id)).toContain(a.document.id);
  });
});

describe("downloads", () => {
  it("issues a 5-minute signed URL that serves the bytes, and refuses tampered or expired tokens", async () => {
    const bytes = pdf("download");
    const { version } = await upload({}, { name: "d.pdf", bytes });
    const url = await docs.downloadUrl(staff, version.id);
    const token = new URL(url, "http://x").searchParams.get("t")!;
    const payload = verifyToken(token)!;
    expect(payload.exp - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(verifyToken(token, Date.now() + 5 * 60 * 1000 + 1000)).toBeNull();
    const ok = await filesRoute.GET(new Request(`http://localhost${url}`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(bytes);
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA");
    expect((await filesRoute.GET(new Request(`http://localhost/api/v1/files?t=${tampered}`))).status).toBe(403);
  });

  it("restricted documents are invisible without commission.read; no access without document.read", async () => {
    const { document, version } = await upload({ title: "TEST Agreement", documentType: "AGREEMENT", classification: "RESTRICTED" });
    const docsOnly = await limitedUser(db, ["document.read", "carrier.read"]);
    await expect(docs.downloadUrl(docsOnly, version.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(docs.getDocument(docsOnly, document.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await docs.listDocuments(docsOnly)).map((d) => d.id)).not.toContain(document.id);
    const nobody = await limitedUser(db, ["carrier.read"]);
    await expect(docs.listDocuments(nobody)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(docs.downloadUrl(staff, version.id)).resolves.toMatch(/^\/api\/v1\/files\?t=/);
  });
});

describe("sources", () => {
  it("links a document page or a staff note to a record; requires the note or document", async () => {
    const { version } = await upload();
    const profile = await db.appetiteProfile.findFirstOrThrow({ where: { carrierProduct: { writingCompany: { displayName: "DEMO Summit Mutual" } } } });
    await addSource(staff, { recordType: "APPETITE_PROFILE", recordId: profile.id, sourceKind: "DOCUMENT", documentVersionId: version.id, pageOrSection: "p. 4" });
    await addSource(staff, { recordType: "APPETITE_PROFILE", recordId: profile.id, sourceKind: "USER_ENTERED", sourceNote: "Call with DEMO underwriter" });
    await expect(addSource(staff, { recordType: "APPETITE_PROFILE", recordId: profile.id, sourceKind: "USER_ENTERED" })).rejects.toBeInstanceOf(ValidationError);
    await expect(addSource(staff, { recordType: "APPETITE_PROFILE", recordId: profile.id, sourceKind: "DOCUMENT" })).rejects.toBeInstanceOf(ValidationError);
    await expect(addSource(staff, { recordType: "APPETITE_PROFILE", recordId: "00000000-0000-0000-0000-000000000001", sourceKind: "USER_ENTERED", sourceNote: "x" })).rejects.toBeInstanceOf(ValidationError);
    const list = await listSources(staff, "APPETITE_PROFILE", profile.id);
    expect(list.map((s) => s.sourceKind)).toEqual(["DOCUMENT", "USER_ENTERED"]);
    expect(list[0].pageOrSection).toBe("p. 4");
  });
});

describe("upload straight into a record's sources", () => {
  async function draftProfile() {
    const { marketChain } = await import("../support/fixtures");
    const chain = await marketChain(db);
    const profile = await db.appetiteProfile.create({ data: { carrierProductId: chain.carrierProduct.id, version: 1, status: "DRAFT", ownerUserId: staff.userId } });
    return { chain, profile };
  }

  it("uploads the appetite guide, files it under the carrier, and cites it with a page", async () => {
    const { chain, profile } = await draftProfile();
    const r = await docs.uploadAsSource(staff, { recordType: "APPETITE_PROFILE", recordId: profile.id, pageOrSection: "p. 4" }, { name: "TEST Roofing guide 2027.pdf", bytes: pdf() });
    expect(r.document).toMatchObject({ title: "TEST Roofing guide 2027", documentType: "APPETITE_GUIDE", classification: "INTERNAL" });
    const sources = await listSources(staff, "APPETITE_PROFILE", profile.id);
    expect(sources.map((s) => [s.sourceKind, s.documentVersion?.document.title, s.pageOrSection])).toEqual([["DOCUMENT", "TEST Roofing guide 2027", "p. 4"]]);
    const filed = await db.recordSource.findFirst({ where: { recordType: "ORGANIZATION", recordId: chain.insurer.id, documentVersionId: r.version.id } });
    expect(filed).not.toBeNull();
    expect(await db.auditEvent.count({ where: { entityId: r.document.id, action: "document.upload" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: r.source.id, action: "source.add" } })).toBe(1);
  });

  it("an agreement upload is restricted, and needs commission.read", async () => {
    const { marketChain } = await import("../support/fixtures");
    const chain = await marketChain(db);
    const r = await docs.uploadAsSource(staff, { recordType: "COMMISSION_AGREEMENT", recordId: chain.agreement.id, title: "TEST Agency agreement" }, { name: "a.pdf", bytes: pdf("agreement") });
    expect(r.document).toMatchObject({ title: "TEST Agency agreement", documentType: "AGREEMENT", classification: "RESTRICTED" });
    const noCommission = await limitedUser(db, ["document.read", "document.write", "commission.write"]);
    await expect(docs.uploadAsSource(noCommission, { recordType: "COMMISSION_AGREEMENT", recordId: chain.agreement.id }, { name: "b.pdf", bytes: pdf("b") })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("checks the file like any upload, and saves nothing when it's refused", async () => {
    const { profile } = await draftProfile();
    const before = await db.document.count();
    await expect(docs.uploadAsSource(staff, { recordType: "APPETITE_PROFILE", recordId: profile.id }, { name: "guide.pdf", bytes: new TextEncoder().encode("not really a pdf") })).rejects.toBeInstanceOf(ValidationError);
    await expect(docs.uploadAsSource(staff, { recordType: "APPETITE_PROFILE", recordId: "11111111-1111-4111-8111-111111111111" }, { name: "g.pdf", bytes: pdf() })).rejects.toBeInstanceOf(NotFoundError);
    const readOnly = await limitedUser(db, ["document.read", "appetite.read"]);
    await expect(docs.uploadAsSource(readOnly, { recordType: "APPETITE_PROFILE", recordId: profile.id }, { name: "g.pdf", bytes: pdf() })).rejects.toBeInstanceOf(ForbiddenError);
    // Can upload documents but not edit appetite: the citation fails, so the document isn't kept either.
    const docsOnly = await limitedUser(db, ["document.read", "document.write"]);
    await expect(docs.uploadAsSource(docsOnly, { recordType: "APPETITE_PROFILE", recordId: profile.id }, { name: "g.pdf", bytes: pdf() })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.document.count()).toBe(before);
  });
});
