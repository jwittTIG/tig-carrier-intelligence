import { createHash, randomUUID } from "node:crypto";
import PostalMime from "postal-mime";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { DocumentType, InboxStatus } from "@/generated/prisma/enums";
import { recordAudit, snapshot } from "@/server/audit";
import { assertCan, can, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { mailDriver, type MailDriver } from "@/server/mail/drivers";
import { storage } from "@/server/storage";
import { inspectUpload, scanUpload } from "@/server/storage/inspect";
import { optionalId, optionalText, parse, requiredText } from "@/server/validation";
import { createProfile } from "./appetite";
import { numberSetting } from "./settings";
import { addSource } from "./sources";
import { emailDomainAllowed } from "./users";

/**
 * Email intake (Milestone 6, DECISIONS D20). Staff forward carrier emails to the shared
 * mailbox. Each email becomes an inbox item. Mail forwarded by an active TIG user is
 * accepted; anything else is held for an admin. Attachments of accepted mail go through
 * the same checks as uploads and are stored as documents. Staff then triage: file under a
 * carrier, cite as a source, start an appetite draft, or dismiss. Nothing is published
 * automatically; approvals still apply (D14).
 */

export const SYSTEM_USER_EMAIL = "mail-intake@system.invalid";
const MAX_BODY = 200_000;
const INLINE_IMAGE_MAX = 30 * 1024;

type Tx = Prisma.TransactionClient;

async function systemUserId(): Promise<string> {
  const u = await prisma.user.findUnique({ where: { email: SYSTEM_USER_EMAIL }, select: { id: true } });
  if (!u) throw new Error("The mail-intake system user is missing; run the seed (npm run db:seed).");
  return u.id;
}

/** Audit row for a system action (no signed-in actor). */
async function systemAudit(tx: Tx, entry: { action: string; entityType: string; entityId?: string; after?: unknown }) {
  await tx.auditEvent.create({ data: { actorId: null, action: entry.action, entityType: entry.entityType, entityId: entry.entityId ?? null, afterState: snapshot(entry.after) } });
}

// ───────────────────────────── Parsing helpers ─────────────────────────────

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The original sender in a forwarded email (Gmail and Outlook styles), if present. */
export function forwardedFrom(text: string): string | null {
  const gmail = text.match(/-{2,}\s*Forwarded message\s*-{2,}\s*\r?\n\s*From:\s*([^\r\n]+)/i);
  const outlook = text.match(/^\s*From:\s*([^\r\n]+)\r?\n\s*(?:Sent|Date):/im);
  const hit = (gmail ?? outlook)?.[1]?.trim();
  return hit ? hit.slice(0, 300) : null;
}

export function guessDocumentType(filename: string): DocumentType {
  if (/appetite/i.test(filename)) return "APPETITE_GUIDE";
  if (/guideline|underwriting|uw guide/i.test(filename)) return "UNDERWRITING_GUIDELINES";
  if (/commission/i.test(filename)) return "COMMISSION_SCHEDULE";
  if (/application|\bapp\b/i.test(filename)) return "APPLICATION";
  return "BULLETIN";
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function storeVersion(tx: Tx, o: { title: string; documentType: DocumentType; ownerUserId: string | null; uploadedById: string; bytes: Uint8Array; mimeType: string; hash: string; key: string }) {
  const doc = await tx.document.create({ data: { title: o.title.slice(0, 200) || "(untitled)", documentType: o.documentType, classification: "INTERNAL", ownerUserId: o.ownerUserId } });
  return tx.documentVersion.create({
    data: { documentId: doc.id, versionNumber: 1, objectKey: o.key, sha256: o.hash, mimeType: o.mimeType, sizeBytes: BigInt(o.bytes.length), uploadedById: o.uploadedById },
  });
}

type ParsedAttachment = { filename: string; mimeType: string; bytes: Uint8Array; inline: boolean };

/** Checks and stores one attachment; returns the attachment row data. */
async function processAttachment(tx: Tx, a: ParsedAttachment, ownerUserId: string | null, uploadedById: string) {
  const hash = sha(a.bytes);
  const base = { filename: a.filename.slice(0, 200), mimeType: a.mimeType.slice(0, 120), sizeBytes: a.bytes.length, sha256: hash };
  if (a.inline && a.mimeType.startsWith("image/") && a.bytes.length <= INLINE_IMAGE_MAX) return { ...base, documentVersionId: null, rejectedReason: "Inline image (signature or logo), not stored." };
  const existing = await tx.documentVersion.findFirst({ where: { sha256: hash, document: { status: "ACTIVE" } }, orderBy: { uploadedAt: "asc" } });
  if (existing) return { ...base, documentVersionId: existing.id, rejectedReason: null };
  const inspected = await inspectUpload(a.filename, a.bytes, (await numberSetting("document.max_upload_mb", tx)) * 1024 * 1024);
  if (!inspected.ok) return { ...base, documentVersionId: null, rejectedReason: inspected.reason };
  if (!(await scanUpload(a.bytes)).clean) return { ...base, documentVersionId: null, rejectedReason: "Failed the malware scan." };
  const key = `inbox/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
  await storage().put(key, a.bytes, inspected.mimeType);
  const v = await storeVersion(tx, { title: a.filename, documentType: guessDocumentType(a.filename), ownerUserId, uploadedById, bytes: a.bytes, mimeType: inspected.mimeType, hash, key });
  return { ...base, documentVersionId: v.id, rejectedReason: null };
}

async function parseRaw(raw: Uint8Array) {
  const email = await PostalMime.parse(raw);
  const header = (name: string) => email.headers.find((h) => h.key.toLowerCase() === name)?.value ?? null;
  const text = (email.text?.trim() || (email.html ? htmlToText(email.html) : "")).slice(0, MAX_BODY);
  const attachments: ParsedAttachment[] = (email.attachments ?? []).map((a, i) => ({
    filename: a.filename || `attachment-${i + 1}`,
    mimeType: a.mimeType || "application/octet-stream",
    bytes: typeof a.content === "string" ? new TextEncoder().encode(a.content) : new Uint8Array(a.content as ArrayBuffer),
    inline: a.disposition === "inline",
  }));
  return {
    messageId: email.messageId?.replace(/^<|>$/g, "").trim() || null,
    fromAddress: (email.from?.address ?? "").toLowerCase(),
    fromName: email.from?.name || null,
    subject: (email.subject ?? "(no subject)").slice(0, 500),
    receivedAt: email.date ? new Date(email.date) : new Date(),
    text,
    authResults: header("authentication-results")?.slice(0, 1000) ?? null,
    attachments,
  };
}

// ───────────────────────────── Intake run ─────────────────────────────

export type IntakeResult = { mailbox: string; checked: number; added: number; duplicates: number; held: number; errors: string[] };

/**
 * Checks the mailbox once. Called by an admin ("Check mailbox now", needs inbox.manage) or by
 * the scheduled route (ctx = null; the route checks CRON_SECRET). Each message is handled on
 * its own: one bad email doesn't stop the run.
 */
export async function runIntake(ctx: AuthContext | null, driver: MailDriver = mailDriver()): Promise<IntakeResult> {
  if (ctx) assertCan(ctx, "inbox.manage");
  const state = await prisma.mailIntakeState.findUnique({ where: { mailbox: driver.mailbox } });
  const result: IntakeResult = { mailbox: driver.mailbox, checked: 0, added: 0, duplicates: 0, held: 0, errors: [] };
  let deltaLink = state?.deltaLink ?? null;
  try {
    const fetched = await driver.fetchNew(deltaLink);
    deltaLink = fetched.deltaLink;
    const systemId = await systemUserId();
    for (const m of fetched.messages) {
      result.checked++;
      try {
        const p = await parseRaw(m.raw);
        const messageKey = p.messageId ?? `sha256:${sha(m.raw)}`;
        if (await prisma.inboundMessage.findUnique({ where: { messageKey }, select: { id: true } })) {
          result.duplicates++;
          continue;
        }
        const sender = p.fromAddress && emailDomainAllowed(p.fromAddress)
          ? await prisma.user.findFirst({ where: { email: { equals: p.fromAddress, mode: "insensitive" }, status: "ACTIVE" }, select: { id: true } })
          : null;
        const rawKey = `inbox/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.eml`;
        await storage().put(rawKey, m.raw, "message/rfc822");
        await prisma.$transaction(async (tx) => {
          const rawVersion = await storeVersion(tx, { title: `Email: ${p.subject}`, documentType: "EMAIL", ownerUserId: sender?.id ?? null, uploadedById: systemId, bytes: m.raw, mimeType: "message/rfc822", hash: sha(m.raw), key: rawKey });
          const msg = await tx.inboundMessage.create({
            data: {
              source: driver.source,
              mailbox: driver.mailbox,
              externalId: m.externalId.slice(0, 500),
              messageKey,
              fromAddress: p.fromAddress || "(unknown)",
              fromName: p.fromName,
              originalFrom: forwardedFrom(p.text),
              subject: p.subject,
              receivedAt: p.receivedAt,
              bodyText: p.text,
              authResults: p.authResults,
              senderStatus: sender ? "ACCEPTED" : "HELD",
              senderUserId: sender?.id ?? null,
              rawDocumentVersionId: rawVersion.id,
            },
          });
          for (const a of p.attachments) {
            // Attachments from unknown senders are stored only once an admin accepts the email.
            const row = sender ? await processAttachment(tx, a, sender.id, systemId) : { filename: a.filename.slice(0, 200), mimeType: a.mimeType.slice(0, 120), sizeBytes: a.bytes.length, sha256: sha(a.bytes), documentVersionId: null, rejectedReason: "Held: sender isn't a TIG user. Stored if an admin accepts the email." };
            await tx.inboundAttachment.create({ data: { messageId: msg.id, ...row } });
          }
          await systemAudit(tx, { action: "inbox.receive", entityType: "inbound_message", entityId: msg.id, after: { subject: msg.subject, from: msg.fromAddress, senderStatus: msg.senderStatus, attachments: p.attachments.length } });
        });
        result.added++;
        if (!sender) result.held++;
      } catch (e) {
        result.errors.push(`${m.externalId}: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`);
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message.slice(0, 300) : "Mail intake failed.");
  }
  await prisma.mailIntakeState.upsert({
    where: { mailbox: driver.mailbox },
    update: { deltaLink, lastRunAt: new Date(), lastError: result.errors[0] ?? null, lastCount: result.added },
    create: { mailbox: driver.mailbox, deltaLink, lastRunAt: new Date(), lastError: result.errors[0] ?? null, lastCount: result.added },
  });
  return result;
}

// ───────────────────────────── Reads ─────────────────────────────

const listSchema = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["NEW", "TRIAGED", "DISMISSED", "HELD"]).optional()),
  organizationId: optionalId,
  q: optionalText(100),
});

export async function listInbox(ctx: AuthContext, filters: z.input<typeof listSchema> = {}) {
  assertCan(ctx, "inbox.read");
  const f = parse(listSchema, filters);
  const where: Prisma.InboundMessageWhereInput = {
    ...(f.status === "HELD" ? { senderStatus: "HELD" } : f.status ? { status: f.status as InboxStatus, senderStatus: { not: "HELD" } } : { senderStatus: { not: "DISCARDED" } }),
    ...(f.organizationId && { organizationId: f.organizationId }),
    ...(f.q && { OR: [{ subject: { contains: f.q, mode: "insensitive" } }, { bodyText: { contains: f.q, mode: "insensitive" } }, { originalFrom: { contains: f.q, mode: "insensitive" } }] }),
  };
  const items = await prisma.inboundMessage.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: 200,
    select: {
      id: true, subject: true, fromAddress: true, fromName: true, originalFrom: true, receivedAt: true, status: true, senderStatus: true,
      organization: { select: { id: true, displayName: true } },
      senderUser: { select: { name: true } },
      _count: { select: { attachments: true } },
    },
  });
  const state = await prisma.mailIntakeState.findMany({ orderBy: { lastRunAt: "desc" } });
  const counts = {
    new: await prisma.inboundMessage.count({ where: { status: "NEW", senderStatus: "ACCEPTED" } }),
    held: await prisma.inboundMessage.count({ where: { senderStatus: "HELD" } }),
  };
  return { items, state, counts };
}

/** Carriers this email may be about: contacts or websites matching the original sender's domain. */
async function suggestCarriers(originalFrom: string | null, body: string) {
  const emails = [...new Set([originalFrom ?? "", body.slice(0, 5000)].join(" ").toLowerCase().match(/[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}/g) ?? [])];
  const domains = [...new Set(emails.map((e) => e.split("@")[1]).filter((d) => !emailDomainAllowed(`x@${d}`)))].slice(0, 5);
  if (!domains.length) return [];
  const byContact = await prisma.contactAssignment.findMany({
    where: { contact: { OR: domains.map((d) => ({ email: { endsWith: `@${d}`, mode: "insensitive" as const } })) } },
    select: { organization: { select: { id: true, displayName: true } } },
    take: 20,
  });
  const byWebsite = await prisma.organization.findMany({
    where: { type: { not: "AGENCY" }, OR: domains.map((d) => ({ website: { contains: d, mode: "insensitive" as const } })) },
    select: { id: true, displayName: true },
    take: 10,
  });
  return [...new Map([...byContact.map((c) => c.organization), ...byWebsite].map((o) => [o.id, o])).values()];
}

export async function getInboxMessage(ctx: AuthContext, id: string) {
  assertCan(ctx, "inbox.read");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Email not found.");
  const m = await prisma.inboundMessage.findUnique({
    where: { id },
    include: {
      attachments: { include: { documentVersion: { select: { id: true, versionNumber: true, document: { select: { id: true, title: true, documentType: true } } } } } },
      organization: { select: { id: true, displayName: true } },
      senderUser: { select: { name: true } },
      triagedBy: { select: { name: true } },
      rawDocumentVersion: { select: { id: true, documentId: true } },
    },
  });
  if (!m) throw new NotFoundError("Email not found.");
  const citedBy = await prisma.recordSource.findMany({
    where: { documentVersionId: { in: [m.rawDocumentVersionId, ...m.attachments.map((a) => a.documentVersionId).filter((x): x is string => !!x)] }, recordType: { not: "ORGANIZATION" } },
    select: { recordType: true, recordId: true, pageOrSection: true },
  });
  return { ...m, suggestions: m.organizationId ? [] : await suggestCarriers(m.originalFrom, m.bodyText), citedBy };
}

// ───────────────────────────── Triage ─────────────────────────────

async function findAccepted(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Email not found.");
  const m = await tx.inboundMessage.findUnique({ where: { id }, include: { attachments: true } });
  if (!m) throw new NotFoundError("Email not found.");
  if (m.senderStatus !== "ACCEPTED") throw new ConflictError("An admin has to accept this email first (unknown sender).");
  return m;
}

const versionsOf = (m: { rawDocumentVersionId: string; attachments: { documentVersionId: string | null }[] }) => [m.rawDocumentVersionId, ...m.attachments.map((a) => a.documentVersionId).filter((x): x is string => !!x)];

async function markTriaged(tx: Tx, ctx: AuthContext, id: string, before: object, action: string, extra: Prisma.InboundMessageUncheckedUpdateInput = {}) {
  const after = await tx.inboundMessage.update({ where: { id }, data: { status: "TRIAGED", triagedById: ctx.userId, triagedAt: new Date(), ...extra } });
  await recordAudit(tx, ctx, { action, entityType: "inbound_message", entityId: id, before, after: { status: after.status, organizationId: after.organizationId } });
  return after;
}

/** Files the email (and its attachments) under a carrier: they then show on the carrier's Documents tab. */
export async function fileUnderCarrier(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "inbox.triage");
  const { organizationId } = parse(z.object({ organizationId: z.uuid() }), input);
  return prisma.$transaction(async (tx) => {
    const m = await findAccepted(tx, id);
    const org = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!org || org.type === "AGENCY") throw new ValidationError("Carrier not found.");
    for (const v of versionsOf(m)) {
      const already = await tx.recordSource.findFirst({ where: { recordType: "ORGANIZATION", recordId: organizationId, documentVersionId: v } });
      if (!already) await tx.recordSource.create({ data: { recordType: "ORGANIZATION", recordId: organizationId, sourceKind: "DOCUMENT", documentVersionId: v, sourceNote: `Email: ${m.subject}`.slice(0, 1000), createdById: ctx.userId } });
    }
    return markTriaged(tx, ctx, id, { status: m.status, organizationId: m.organizationId }, "inbox.file", { organizationId });
  });
}

const citeSchema = z.object({
  recordType: z.enum(["APPETITE_PROFILE", "COMMISSION_AGREEMENT", "COMMISSION_SCHEDULE", "AGENCY_APPOINTMENT", "CONTACT", "ORGANIZATION"]),
  recordId: z.uuid(),
  documentVersionId: optionalId,
  pageOrSection: optionalText(120),
});

/** Cites the email (or one of its attachments) as a source for a record. */
export async function citeAsSource(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "inbox.triage");
  const data = parse(citeSchema, input);
  return prisma.$transaction(async (tx) => {
    const m = await findAccepted(tx, id);
    const version = data.documentVersionId ?? m.rawDocumentVersionId;
    if (!versionsOf(m).includes(version)) throw new ValidationError("That file isn't part of this email.");
    await addSource(ctx, { recordType: data.recordType, recordId: data.recordId, sourceKind: "DOCUMENT", documentVersionId: version, pageOrSection: data.pageOrSection, sourceNote: `Email: ${m.subject}`.slice(0, 1000) }, tx);
    return markTriaged(tx, ctx, id, { status: m.status }, "inbox.cite");
  });
}

/**
 * Starts an appetite DRAFT for a carrier product with this email as its source, or adds the
 * email as a source to the draft already open for that product. Never approves anything.
 */
export async function startAppetiteDraft(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "inbox.triage");
  const { carrierProductId, documentVersionId } = parse(z.object({ carrierProductId: z.uuid(), documentVersionId: optionalId }), input);
  const m = await findAccepted(prisma, id);
  const version = documentVersionId ?? m.attachments.find((a) => a.documentVersionId)?.documentVersionId ?? m.rawDocumentVersionId;
  if (!versionsOf(m).includes(version)) throw new ValidationError("That file isn't part of this email.");
  const open = await prisma.appetiteProfile.findFirst({ where: { carrierProductId, marketChannelId: null, status: "DRAFT" } });
  const profile = open ?? (await createProfile(ctx, { carrierProductId }));
  const cp = await prisma.carrierProduct.findUniqueOrThrow({ where: { id: carrierProductId }, select: { writingCompanyId: true } });
  await prisma.$transaction(async (tx) => {
    await addSource(ctx, { recordType: "APPETITE_PROFILE", recordId: profile.id, sourceKind: "DOCUMENT", documentVersionId: version, sourceNote: `Email: ${m.subject}`.slice(0, 1000) }, tx);
    await markTriaged(tx, ctx, id, { status: m.status }, "inbox.appetite_draft", { organizationId: m.organizationId ?? cp.writingCompanyId });
  });
  return { profileId: profile.id, reusedDraft: !!open };
}

export async function dismissMessage(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "inbox.triage");
  const { reason } = parse(z.object({ reason: requiredText(500) }), input);
  return prisma.$transaction(async (tx) => {
    const m = await tx.inboundMessage.findUnique({ where: { id } });
    if (!m) throw new NotFoundError("Email not found.");
    if (m.senderStatus === "HELD") throw new ConflictError("Held emails are accepted or discarded by an admin.");
    const after = await tx.inboundMessage.update({ where: { id }, data: { status: "DISMISSED", dismissReason: reason, triagedById: ctx.userId, triagedAt: new Date() } });
    await recordAudit(tx, ctx, { action: "inbox.dismiss", entityType: "inbound_message", entityId: id, before: { status: m.status }, after: { status: after.status, reason } });
    return after;
  });
}

/** Admin: accept a held email (its attachments are then checked and stored) or discard it. */
export async function decideHeld(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "inbox.manage");
  const { decision, reason } = parse(z.object({ decision: z.enum(["ACCEPT", "DISCARD"]), reason: requiredText(500) }), input);
  const m = await prisma.inboundMessage.findUnique({ where: { id }, include: { attachments: true, rawDocumentVersion: true } });
  if (!m) throw new NotFoundError("Email not found.");
  if (m.senderStatus !== "HELD") throw new ConflictError("This email isn't held.");
  if (decision === "DISCARD") {
    return prisma.$transaction(async (tx) => {
      const after = await tx.inboundMessage.update({ where: { id }, data: { senderStatus: "DISCARDED", status: "DISMISSED", dismissReason: reason, triagedById: ctx.userId, triagedAt: new Date() } });
      await recordAudit(tx, ctx, { action: "inbox.discard", entityType: "inbound_message", entityId: id, before: { senderStatus: m.senderStatus }, after: { senderStatus: after.senderStatus, reason } });
      return after;
    });
  }
  // Re-read attachments from the stored original and run them through the upload checks.
  const parsed = await parseRaw(await storage().get(m.rawDocumentVersion.objectKey));
  const systemId = await systemUserId();
  return prisma.$transaction(async (tx) => {
    for (const row of m.attachments) {
      const a = parsed.attachments.find((x) => sha(x.bytes) === row.sha256);
      if (!a) continue;
      const done = await processAttachment(tx, a, ctx.userId, systemId);
      await tx.inboundAttachment.update({ where: { id: row.id }, data: { documentVersionId: done.documentVersionId, rejectedReason: done.rejectedReason } });
    }
    // The admin who accepts it stands in as the sender of record.
    const after = await tx.inboundMessage.update({ where: { id }, data: { senderStatus: "ACCEPTED", senderUserId: ctx.userId } });
    await recordAudit(tx, ctx, { action: "inbox.accept_sender", entityType: "inbound_message", entityId: id, before: { senderStatus: m.senderStatus, fromAddress: m.fromAddress }, after: { senderStatus: after.senderStatus, reason } });
    return after;
  });
}

/** Untriaged items older than the inbox.stale_days setting (for data quality and the dashboard). */
export async function staleInboxCount(ctx: AuthContext) {
  if (!can(ctx, "inbox.read")) return 0;
  const days = await numberSetting("inbox.stale_days");
  return prisma.inboundMessage.count({ where: { status: "NEW", senderStatus: "ACCEPTED", receivedAt: { lte: new Date(Date.now() - days * 86_400_000) } } });
}
