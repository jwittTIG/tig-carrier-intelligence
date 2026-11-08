import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Classification, DocumentType } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit";
import { assertCan, can, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { ALLOWED_TYPES, inspectUpload, scanUpload } from "@/server/storage/inspect";
import { SIGNED_URL_TTL_MS, storage } from "@/server/storage";
import { optionalId, optionalText, parse, requiredText } from "@/server/validation";
import { numberSetting } from "./settings";
import { addSource, writePermissionFor } from "./sources";

/**
 * Private documents and versions (PRD screen 8, P0-07). Files are checked by content,
 * scanned, stored under a unique key, never overwritten, and downloaded only through
 * short-lived signed URLs after a permission check. RESTRICTED documents (agreements,
 * commission schedules) also need commission.read.
 */

export type UploadedFile = { name: string; bytes: Uint8Array };

function assertCanReadClass(ctx: AuthContext, classification: Classification) {
  assertCan(ctx, "document.read");
  if (classification === "RESTRICTED") assertCan(ctx, "commission.read");
}

async function maxUploadBytes() {
  return (await numberSetting("document.max_upload_mb")) * 1024 * 1024;
}

async function storeFile(ctx: AuthContext, file: UploadedFile) {
  const inspected = await inspectUpload(file.name, file.bytes, await maxUploadBytes());
  if (!inspected.ok) throw new ValidationError(inspected.reason);
  const scan = await scanUpload(file.bytes);
  if (!scan.clean) throw new ValidationError("The file failed the malware scan and was not stored.");
  const key = `documents/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
  await storage().put(key, file.bytes, inspected.mimeType);
  return { key, ...inspected, scanner: scan.scanner };
}

const metaSchema = z.object({
  title: requiredText(200),
  documentType: z.enum(DocumentType),
  classification: z.enum(Classification).default("INTERNAL"),
  organizationId: optionalId,
});

/** Creates a document with version 1. Optionally files it under a carrier. */
export async function uploadDocument(ctx: AuthContext, input: unknown, file: UploadedFile) {
  assertCan(ctx, "document.write");
  const meta = parse(metaSchema, input);
  if (meta.classification === "RESTRICTED") assertCan(ctx, "commission.read");
  if (meta.organizationId) {
    const org = await prisma.organization.findUnique({ where: { id: meta.organizationId } });
    if (!org || org.type === "AGENCY") throw new ValidationError("Carrier not found.");
  }
  const stored = await storeFile(ctx, file);
  return prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({ data: { title: meta.title, documentType: meta.documentType, classification: meta.classification, ownerUserId: ctx.userId } });
    const version = await tx.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, objectKey: stored.key, sha256: stored.sha256, mimeType: stored.mimeType, sizeBytes: BigInt(stored.sizeBytes), uploadedById: ctx.userId },
    });
    if (meta.organizationId) {
      await tx.recordSource.create({ data: { recordType: "ORGANIZATION", recordId: meta.organizationId, sourceKind: "DOCUMENT", documentVersionId: version.id, createdById: ctx.userId, sourceNote: "Filed under carrier" } });
    }
    await recordAudit(tx, ctx, { action: "document.upload", entityType: "document", entityId: doc.id, after: { ...doc, version: { ...version, originalName: file.name, scanner: stored.scanner } } });
    return { document: doc, version };
  });
}

const sourceUploadSchema = z.object({
  recordType: z.enum(["APPETITE_PROFILE", "COMMISSION_AGREEMENT"]),
  recordId: z.uuid(),
  title: optionalText(200),
  pageOrSection: optionalText(120),
});

/** What a record's source upload becomes: its carrier, document type and classification. */
async function sourceTarget(recordType: "APPETITE_PROFILE" | "COMMISSION_AGREEMENT", recordId: string) {
  if (recordType === "APPETITE_PROFILE") {
    const p = await prisma.appetiteProfile.findUnique({ where: { id: recordId }, select: { carrierProduct: { select: { writingCompanyId: true } } } });
    if (!p) throw new NotFoundError("Appetite profile not found.");
    return { organizationId: p.carrierProduct.writingCompanyId, documentType: "APPETITE_GUIDE" as const, classification: "INTERNAL" as const };
  }
  const a = await prisma.commissionAgreement.findUnique({ where: { id: recordId }, select: { marketChannel: { select: { carrierProduct: { select: { writingCompanyId: true } } } } } });
  if (!a) throw new NotFoundError("Commission agreement not found.");
  return { organizationId: a.marketChannel.carrierProduct.writingCompanyId, documentType: "AGREEMENT" as const, classification: "RESTRICTED" as const };
}

/**
 * Uploads a file (an appetite guide, or an agreement) and cites it as the record's source in
 * one step. The document is filed under the record's carrier and gets the same checks as any
 * upload. If citing fails, nothing is saved in the database.
 */
export async function uploadAsSource(ctx: AuthContext, input: unknown, file: UploadedFile) {
  assertCan(ctx, "document.write");
  const data = parse(sourceUploadSchema, input);
  // Check every permission before the file is stored, so a refusal leaves nothing behind.
  assertCan(ctx, writePermissionFor(data.recordType));
  const target = await sourceTarget(data.recordType, data.recordId);
  if (target.classification === "RESTRICTED") assertCan(ctx, "commission.read");
  const title = (data.title ?? file.name.replace(/\.[^.]+$/, "")).slice(0, 200).trim() || file.name;
  const stored = await storeFile(ctx, file);
  return prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({ data: { title, documentType: target.documentType, classification: target.classification, ownerUserId: ctx.userId } });
    const version = await tx.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, objectKey: stored.key, sha256: stored.sha256, mimeType: stored.mimeType, sizeBytes: BigInt(stored.sizeBytes), uploadedById: ctx.userId },
    });
    await tx.recordSource.create({ data: { recordType: "ORGANIZATION", recordId: target.organizationId, sourceKind: "DOCUMENT", documentVersionId: version.id, createdById: ctx.userId, sourceNote: "Filed under carrier" } });
    await recordAudit(tx, ctx, { action: "document.upload", entityType: "document", entityId: doc.id, after: { ...doc, version: { ...version, originalName: file.name, scanner: stored.scanner } } });
    const source = await addSource(ctx, { recordType: data.recordType, recordId: data.recordId, sourceKind: "DOCUMENT", documentVersionId: version.id, pageOrSection: data.pageOrSection }, tx);
    return { document: doc, version, source };
  });
}

export async function uploadVersion(ctx: AuthContext, documentId: string, file: UploadedFile) {
  assertCan(ctx, "document.write");
  const doc = await findDocument(documentId);
  assertCanReadClass(ctx, doc.classification);
  if (doc.status !== "ACTIVE") throw new ValidationError("This document is archived.");
  const stored = await storeFile(ctx, file);
  return prisma.$transaction(async (tx) => {
    const last = await tx.documentVersion.findFirst({ where: { documentId }, orderBy: { versionNumber: "desc" } });
    const version = await tx.documentVersion.create({
      data: { documentId, versionNumber: (last?.versionNumber ?? 0) + 1, objectKey: stored.key, sha256: stored.sha256, mimeType: stored.mimeType, sizeBytes: BigInt(stored.sizeBytes), uploadedById: ctx.userId },
    });
    await recordAudit(tx, ctx, { action: "document.version", entityType: "document", entityId: documentId, after: { ...version, originalName: file.name, scanner: stored.scanner } });
    return version;
  });
}

async function findDocument(id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Document not found.");
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError("Document not found.");
  return doc;
}

const listSchema = z.object({
  q: optionalText(100),
  documentType: z.preprocess((v) => (v === "" ? undefined : v), z.enum(DocumentType).optional()),
  organizationId: optionalId,
  includeArchived: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).default(false),
});

export async function listDocuments(ctx: AuthContext, filters: z.input<typeof listSchema> = {}) {
  assertCan(ctx, "document.read");
  const f = parse(listSchema, filters);
  let ids: string[] | undefined;
  if (f.organizationId) {
    const links = await prisma.recordSource.findMany({ where: { recordType: "ORGANIZATION", recordId: f.organizationId, documentVersionId: { not: null } }, select: { documentVersion: { select: { documentId: true } } } });
    ids = [...new Set(links.map((l) => l.documentVersion!.documentId))];
  }
  const rows = await prisma.document.findMany({
    where: {
      ...(ids && { id: { in: ids } }),
      ...(f.documentType && { documentType: f.documentType }),
      ...(f.q && { title: { contains: f.q, mode: "insensitive" } }),
      ...(!f.includeArchived && { status: "ACTIVE" }),
      // Restricted documents are left out for anyone without commission.read.
      ...(!can(ctx, "commission.read") && { classification: { not: "RESTRICTED" } }),
    },
    orderBy: { updatedAt: "desc" },
    include: { owner: { select: { name: true } }, versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  return rows.map((d) => ({ ...d, latest: d.versions[0] ? { ...d.versions[0], sizeBytes: Number(d.versions[0].sizeBytes) } : null, versions: undefined }));
}

export async function getDocument(ctx: AuthContext, id: string) {
  const doc = await findDocument(id);
  assertCanReadClass(ctx, doc.classification);
  const full = await prisma.document.findUniqueOrThrow({
    where: { id },
    include: {
      owner: { select: { name: true } },
      versions: { orderBy: { versionNumber: "desc" }, include: { uploadedBy: { select: { name: true } }, recordSources: { include: { createdBy: { select: { name: true } } } } } },
    },
  });
  // Other documents holding identical bytes (duplicate detection by sha256).
  const hashes = full.versions.map((v) => v.sha256);
  const duplicates = await prisma.documentVersion.findMany({
    where: { sha256: { in: hashes }, documentId: { not: id } },
    select: { sha256: true, document: { select: { id: true, title: true } } },
  });
  return { ...full, versions: full.versions.map((v) => ({ ...v, sizeBytes: Number(v.sizeBytes) })), duplicates };
}

/** Versions a user may cite as a source (picker). */
export async function listCitableVersions(ctx: AuthContext) {
  assertCan(ctx, "document.read");
  const rows = await prisma.documentVersion.findMany({
    where: { document: { status: "ACTIVE", ...(!can(ctx, "commission.read") && { classification: { not: "RESTRICTED" } }) } },
    orderBy: [{ document: { title: "asc" } }, { versionNumber: "desc" }],
    select: { id: true, versionNumber: true, document: { select: { title: true, documentType: true } } },
  });
  return rows;
}

/** Permission check, then a 5-minute signed URL. */
export async function downloadUrl(ctx: AuthContext, versionId: string, opts: { view?: boolean } = {}): Promise<string> {
  if (!z.uuid().safeParse(versionId).success) throw new NotFoundError("Document not found.");
  const v = await prisma.documentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
  if (!v) throw new NotFoundError("Document not found.");
  try {
    assertCanReadClass(ctx, v.document.classification);
  } catch (e) {
    // Don't reveal that a restricted document exists.
    if (e instanceof ForbiddenError) throw new NotFoundError("Document not found.");
    throw e;
  }
  const ext = ALLOWED_TYPES[v.mimeType]?.ext ?? "bin";
  const safe = v.document.title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "document";
  return storage().signedUrl(v.objectKey, { expiresAt: new Date(Date.now() + SIGNED_URL_TTL_MS), filename: `${safe}-v${v.versionNumber}.${ext}`, contentType: v.mimeType, inline: !!opts.view && v.mimeType === "application/pdf" });
}

export async function setDocumentArchived(ctx: AuthContext, id: string, archived: boolean) {
  assertCan(ctx, "document.write");
  const before = await findDocument(id);
  assertCanReadClass(ctx, before.classification);
  return prisma.$transaction(async (tx) => {
    const after = await tx.document.update({ where: { id }, data: { status: archived ? "ARCHIVED" : "ACTIVE" } });
    await recordAudit(tx, ctx, { action: archived ? "document.archive" : "document.restore", entityType: "document", entityId: id, before, after });
    return after;
  });
}

const reclassSchema = z.object({ title: requiredText(200), documentType: z.enum(DocumentType), classification: z.enum(Classification) });

export async function updateDocument(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "document.write");
  const data = parse(reclassSchema, input);
  const before = await findDocument(id);
  assertCanReadClass(ctx, before.classification);
  if (data.classification === "RESTRICTED") assertCan(ctx, "commission.read");
  return prisma.$transaction(async (tx) => {
    const after = await tx.document.update({ where: { id }, data });
    await recordAudit(tx, ctx, { action: "document.update", entityType: "document", entityId: id, before, after });
    return after;
  });
}
