import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cron from "@/app/api/cron/mail-intake/route";
import type { AuthContext } from "@/server/auth/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { GraphDriver } from "@/server/mail/drivers";
import { listProfilesForCarrier } from "@/server/services/appetite";
import { listDocuments } from "@/server/services/documents";
import * as inbox from "@/server/services/inbox";
import { demoContext, limitedUser } from "../support/auth";
import { testPrisma } from "../support/db";
import { eml, MemoryDriver, pdfBytes } from "../support/eml";

const db = testPrisma();
let staff: AuthContext;
let admin: AuthContext;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  admin = await demoContext(db, "demo.admin@example.invalid");
});

const forwarded = (subject: string, extra: Partial<Parameters<typeof eml>[0]> = {}) =>
  eml({
    from: "DEMO Producer <demo.producer@example.invalid>",
    subject,
    body: "FYI\r\n\r\n---------- Forwarded message ---------\r\nFrom: Demo Underwriter <demo.uw@example.invalid>\r\nDate: Tue, Nov 3, 2026\r\nSubject: Roofing appetite update\r\n\r\nWe now write roofing in TN.",
    attachments: [{ filename: "Roofing appetite guide 2027.pdf", contentType: "application/pdf", bytes: pdfBytes("guide") }],
    ...extra,
  });

describe("intake", () => {
  it("takes in mail forwarded by staff: stores the original, the attachment as a document, and audits", async () => {
    const subject = `TEST Fwd: roofing ${randomUUID().slice(0, 6)}`;
    const driver = new MemoryDriver().add(forwarded(subject));
    const r = await inbox.runIntake(admin, driver);
    expect(r).toMatchObject({ checked: 1, added: 1, duplicates: 0, held: 0, errors: [] });
    const m = await db.inboundMessage.findFirstOrThrow({ where: { subject }, include: { attachments: { include: { documentVersion: { include: { document: true } } } }, rawDocumentVersion: { include: { document: true } } } });
    expect(m).toMatchObject({ senderStatus: "ACCEPTED", status: "NEW", fromAddress: "demo.producer@example.invalid" });
    expect(m.senderUserId).toBe(staff.userId);
    expect(m.originalFrom).toBe("Demo Underwriter <demo.uw@example.invalid>");
    expect(m.bodyText).toMatch(/write roofing in TN/);
    expect(m.rawDocumentVersion.mimeType).toBe("message/rfc822");
    expect(m.rawDocumentVersion.document.documentType).toBe("EMAIL");
    expect(m.attachments[0].documentVersion?.document).toMatchObject({ documentType: "APPETITE_GUIDE", classification: "INTERNAL" });
    expect(await db.auditEvent.count({ where: { entityId: m.id, action: "inbox.receive" } })).toBe(1);
    // The same mailbox again: nothing new (Message-ID already seen).
    expect(await inbox.runIntake(admin, driver)).toMatchObject({ checked: 1, added: 0, duplicates: 1 });
    expect((await db.mailIntakeState.findUniqueOrThrow({ where: { mailbox: driver.mailbox } })).lastCount).toBe(0);
  });

  it("dedupes by content when there's no Message-ID, and reuses identical attachments", async () => {
    const bytes = pdfBytes("same");
    const one = eml({ from: "demo.producer@example.invalid", messageId: null, subject: `TEST no-id ${randomUUID().slice(0, 4)}`, attachments: [{ filename: "a.pdf", contentType: "application/pdf", bytes }] });
    const two = eml({ from: "demo.producer@example.invalid", subject: `TEST same file ${randomUUID().slice(0, 4)}`, attachments: [{ filename: "a-copy.pdf", contentType: "application/pdf", bytes }] });
    const r = await inbox.runIntake(admin, new MemoryDriver().add(one).add(one).add(two));
    expect(r).toMatchObject({ added: 2, duplicates: 1 });
    const atts = await db.inboundAttachment.findMany({ where: { sha256: (await db.inboundAttachment.findFirstOrThrow({ where: { filename: "a.pdf" } })).sha256 } });
    expect(new Set(atts.map((a) => a.documentVersionId)).size).toBe(1);
  });

  it("refuses bad attachments with a reason and skips small inline images", async () => {
    const subject = `TEST bad files ${randomUUID().slice(0, 6)}`;
    const eicar = new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    await inbox.runIntake(admin, new MemoryDriver().add(eml({
      from: "demo.producer@example.invalid",
      subject,
      attachments: [
        { filename: "setup.exe", contentType: "application/octet-stream", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]) },
        { filename: "renamed.docx", contentType: "application/pdf", bytes: pdfBytes() },
        { filename: "eicar.txt", contentType: "text/plain", bytes: eicar },
        { filename: "logo.png", contentType: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), inline: true },
      ],
    })));
    const m = await db.inboundMessage.findFirstOrThrow({ where: { subject }, include: { attachments: true } });
    const reason = (f: string) => m.attachments.find((a) => a.filename === f)?.rejectedReason;
    expect(reason("setup.exe")).toMatch(/isn't accepted/);
    expect(reason("renamed.docx")).toMatch(/content is PDF/);
    expect(reason("eicar.txt")).toMatch(/malware scan/);
    expect(reason("logo.png")).toMatch(/Inline image/);
    expect(m.attachments.every((a) => a.documentVersionId === null)).toBe(true);
  });

  it("holds mail from anyone who isn't an active TIG user; an admin accepts or discards it", async () => {
    const s1 = `TEST outsider ${randomUUID().slice(0, 6)}`;
    const s2 = `TEST spam ${randomUUID().slice(0, 6)}`;
    const r = await inbox.runIntake(admin, new MemoryDriver()
      .add(eml({ from: "Carrier Marketing <news@carrier.example.invalid>", subject: s1, attachments: [{ filename: "Bulletin.pdf", contentType: "application/pdf", bytes: pdfBytes() }] }))
      .add(eml({ from: "spam@elsewhere.test", subject: s2 })));
    expect(r.held).toBe(2);
    const held = await db.inboundMessage.findFirstOrThrow({ where: { subject: s1 }, include: { attachments: true } });
    expect(held.senderStatus).toBe("HELD");
    expect(held.attachments[0]).toMatchObject({ documentVersionId: null });
    expect(held.attachments[0].rejectedReason).toMatch(/Held/);
    await expect(inbox.fileUnderCarrier(staff, held.id, { organizationId: (await db.organization.findFirstOrThrow({ where: { displayName: "DEMO Summit Mutual" } })).id })).rejects.toBeInstanceOf(ConflictError);
    await expect(inbox.decideHeld(staff, held.id, { decision: "ACCEPT", reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inbox.dismissMessage(staff, held.id, { reason: "x" })).rejects.toBeInstanceOf(ConflictError);

    await inbox.decideHeld(admin, held.id, { decision: "ACCEPT", reason: "Real carrier bulletin" });
    const accepted = await db.inboundMessage.findUniqueOrThrow({ where: { id: held.id }, include: { attachments: true } });
    expect(accepted).toMatchObject({ senderStatus: "ACCEPTED", senderUserId: admin.userId });
    expect(accepted.attachments[0].documentVersionId).not.toBeNull();

    const spam = await db.inboundMessage.findFirstOrThrow({ where: { subject: s2 } });
    await inbox.decideHeld(admin, spam.id, { decision: "DISCARD", reason: "Spam" });
    expect(await db.inboundMessage.findUniqueOrThrow({ where: { id: spam.id } })).toMatchObject({ senderStatus: "DISCARDED", status: "DISMISSED" });
    expect((await inbox.listInbox(staff)).items.map((i) => i.id)).not.toContain(spam.id);
  });

  it("an empty or broken mailbox reports errors instead of crashing", async () => {
    const r = await inbox.runIntake(admin, { source: "DEV", mailbox: "broken@example.invalid", fetchNew: async () => { throw new Error("mailbox unreachable"); } });
    expect(r.errors).toEqual(["mailbox unreachable"]);
    expect((await db.mailIntakeState.findUniqueOrThrow({ where: { mailbox: "broken@example.invalid" } })).lastError).toBe("mailbox unreachable");
  });
});

describe("triage", () => {
  async function receive(subject = `TEST triage ${randomUUID().slice(0, 6)}`) {
    await inbox.runIntake(admin, new MemoryDriver().add(forwarded(subject)));
    return db.inboundMessage.findFirstOrThrow({ where: { subject }, include: { attachments: true } });
  }

  it("files under a carrier: the email and attachment show on the carrier's documents", async () => {
    const summit = await db.organization.findFirstOrThrow({ where: { displayName: "DEMO Summit Mutual" } });
    // A carrier contact with an outside domain (TIG's own domains are never used for suggestions).
    const uwEmail = `uw.${randomUUID().slice(0, 6)}@summit-mutual.test`;
    const uw = await db.contact.create({ data: { firstName: "Test", lastName: "Summit UW", email: uwEmail } });
    await db.contactAssignment.create({ data: { contactId: uw.id, organizationId: summit.id, role: "UNDERWRITER" } });
    const subject = `TEST file ${randomUUID().slice(0, 6)}`;
    await inbox.runIntake(admin, new MemoryDriver().add(forwarded(subject, { body: `FYI

---------- Forwarded message ---------
From: Test Summit UW <${uwEmail}>

New guide attached.` })));
    const m = await db.inboundMessage.findFirstOrThrow({ where: { subject }, include: { attachments: true } });
    const detail = await inbox.getInboxMessage(staff, m.id);
    expect(detail.suggestions.map((s) => s.id)).toContain(summit.id);
    await inbox.fileUnderCarrier(staff, m.id, { organizationId: summit.id });
    const after = await db.inboundMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(after).toMatchObject({ status: "TRIAGED", organizationId: summit.id, triagedById: staff.userId });
    const docIds = (await listDocuments(staff, { organizationId: summit.id })).map((d) => d.id);
    const attDoc = await db.documentVersion.findUniqueOrThrow({ where: { id: m.attachments[0].documentVersionId! } });
    expect(docIds).toContain(attDoc.documentId);
    expect((await inbox.listInbox(staff, { organizationId: summit.id })).items.map((i) => i.id)).toContain(m.id);
  });

  it("starts an appetite draft with the attachment as its source (never approved)", async () => {
    const m = await receive();
    const org = await db.organization.create({ data: { legalName: `TEST Inbox Carrier ${randomUUID().slice(0, 6)}`, displayName: `TEST Inbox ${randomUUID().slice(0, 6)}`, type: "INSURER" } });
    const product = await db.insuranceProduct.findFirstOrThrow();
    const cp = await db.carrierProduct.create({ data: { writingCompanyId: org.id, productId: product.id } });
    const r = await inbox.startAppetiteDraft(staff, m.id, { carrierProductId: cp.id });
    expect(r.reusedDraft).toBe(false);
    const profiles = await listProfilesForCarrier(staff, org.id);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].status).toBe("DRAFT");
    const src = await db.recordSource.findFirstOrThrow({ where: { recordType: "APPETITE_PROFILE", recordId: r.profileId } });
    expect(src.documentVersionId).toBe(m.attachments[0].documentVersionId);
    // A second email for the same product adds to the open draft instead of failing.
    const m2 = await receive();
    expect(await inbox.startAppetiteDraft(staff, m2.id, { carrierProductId: cp.id })).toEqual({ profileId: r.profileId, reusedDraft: true });
    expect((await db.inboundMessage.findUniqueOrThrow({ where: { id: m2.id } })).organizationId).toBe(org.id);
  });

  it("cites the email on a record, and refuses files from another email", async () => {
    const m = await receive();
    const other = await receive();
    // Its own carrier product and draft, so other test files are unaffected.
    const org = await db.organization.create({ data: { legalName: `TEST Cite ${randomUUID().slice(0, 6)} Co`, displayName: `TEST Cite ${randomUUID().slice(0, 6)}`, type: "INSURER" } });
    const cp = await db.carrierProduct.create({ data: { writingCompanyId: org.id, productId: (await db.insuranceProduct.findFirstOrThrow()).id } });
    const profile = await db.appetiteProfile.create({ data: { carrierProductId: cp.id, version: 1 } });
    await inbox.citeAsSource(staff, m.id, { recordType: "APPETITE_PROFILE", recordId: profile.id, pageOrSection: "body" });
    await expect(inbox.citeAsSource(staff, m.id, { recordType: "APPETITE_PROFILE", recordId: profile.id, documentVersionId: other.attachments[0].documentVersionId })).rejects.toBeInstanceOf(ValidationError);
    expect((await inbox.getInboxMessage(staff, m.id)).citedBy.map((c) => c.recordId)).toContain(profile.id);
  });

  it("dismiss needs a reason; reading needs inbox.read; checking the mailbox needs inbox.manage", async () => {
    const m = await receive();
    await expect(inbox.dismissMessage(staff, m.id, { reason: "" })).rejects.toBeInstanceOf(ValidationError);
    await inbox.dismissMessage(staff, m.id, { reason: "Duplicate of an earlier bulletin" });
    expect((await db.inboundMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("DISMISSED");
    const nobody = await limitedUser(db, ["carrier.read"]);
    await expect(inbox.listInbox(nobody)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inbox.getInboxMessage(nobody, m.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inbox.runIntake(staff, new MemoryDriver())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("parsing helpers", () => {
  it("turns HTML into text and finds Outlook-style forwarded senders", () => {
    expect(inbox.htmlToText("<style>x{}</style><p>Hello&nbsp;<b>there</b></p><script>alert(1)</script>Line<br>two")).toBe("Hello there\nLine\ntwo");
    expect(inbox.forwardedFrom("hi\n\nFrom: Pat UW <pat@carrier.example>\nSent: Monday\nTo: me")).toBe("Pat UW <pat@carrier.example>");
    expect(inbox.forwardedFrom("no forward here")).toBeNull();
    expect(inbox.guessDocumentType("2027 Underwriting Guidelines.pdf")).toBe("UNDERWRITING_GUIDELINES");
  });
});

describe("Graph reader (mocked Microsoft responses; not tested against Microsoft)", () => {
  it("signs in, follows delta pages, skips removed items, downloads MIME, returns the delta link", async () => {
    const calls: string[] = [];
    const fake: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url.replace(/\?.*$/, ""));
      if (url.includes("oauth2/v2.0/token")) return Response.json({ access_token: "t" });
      if (url.includes("/delta") && !url.includes("page=2")) return Response.json({ value: [{ id: "A" }, { id: "B", "@removed": {} }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/x/mailFolders/inbox/messages/delta?page=2" });
      if (url.includes("page=2")) return Response.json({ value: [{ id: "C" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-next" });
      if (url.endsWith("/$value")) return new Response(Buffer.from(eml({ from: "demo.producer@example.invalid", subject: "x" })));
      return new Response("not found", { status: 404 });
    };
    const g = new GraphDriver("carrier-updates@example.invalid", { tenantId: "tid", clientId: "cid", clientSecret: "s" }, fake);
    const r = await g.fetchNew(null);
    expect(r.messages.map((m) => m.externalId)).toEqual(["A", "C"]);
    expect(r.deltaLink).toBe("https://graph.microsoft.com/v1.0/delta-next");
    expect(calls.filter((c) => c.endsWith("/$value"))).toHaveLength(2);
    const bad: typeof fetch = async () => new Response("no", { status: 401 });
    await expect(new GraphDriver("m", { tenantId: "t", clientId: "c", clientSecret: "s" }, bad).fetchNew(null)).rejects.toThrow(/sign-in for mail intake failed/);
  });
});

describe("scheduled check route", () => {
  it("needs the CRON_SECRET bearer token", async () => {
    const prev = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await cron.GET(new Request("http://localhost/api/cron/mail-intake"))).status).toBe(401);
      process.env.CRON_SECRET = "c".repeat(40);
      expect((await cron.GET(new Request("http://localhost/api/cron/mail-intake", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});

describe("database checks", () => {
  it("an attachment is either stored or has a reason; an accepted sender is a user", async () => {
    const m = await db.inboundMessage.findFirstOrThrow();
    await expect(db.inboundAttachment.create({ data: { messageId: m.id, filename: "x", mimeType: "x", sizeBytes: 1, sha256: "a".repeat(64) } })).rejects.toThrow();
    await expect(db.inboundMessage.update({ where: { id: m.id }, data: { senderStatus: "ACCEPTED", senderUserId: null } })).rejects.toThrow();
  });
});
