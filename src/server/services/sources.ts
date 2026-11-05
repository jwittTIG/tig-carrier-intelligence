import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { RecordType } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit";
import type { PermissionCode } from "@/server/auth/catalog";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { optionalId, optionalText, parse } from "@/server/validation";

type Tx = Prisma.TransactionClient;

/**
 * Provenance links (record_sources). record_sources is polymorphic, so the service checks
 * that the record exists. Sources are append-only: they are history for approved records.
 */
export async function recordExists(tx: Tx, type: RecordType, id: string): Promise<boolean> {
  const where = { where: { id }, select: { id: true } } as const;
  const finders: Record<RecordType, () => Promise<unknown>> = {
    ORGANIZATION: () => tx.organization.findUnique(where),
    CARRIER_PRODUCT: () => tx.carrierProduct.findUnique(where),
    MARKET_CHANNEL: () => tx.marketChannel.findUnique(where),
    AGENCY_APPOINTMENT: () => tx.agencyAppointment.findUnique(where),
    AGENCY_CODE: () => tx.agencyCode.findUnique(where),
    CARRIER_PORTAL: () => tx.carrierPortal.findUnique(where),
    CONTACT: () => tx.contact.findUnique(where),
    CONTACT_ASSIGNMENT: () => tx.contactAssignment.findUnique(where),
    APPETITE_PROFILE: () => tx.appetiteProfile.findUnique(where),
    APPETITE_RULE: () => tx.appetiteRule.findUnique(where),
    UNDERWRITING_REQUIREMENT: () => tx.underwritingRequirement.findUnique(where),
    COVERAGE_CAPABILITY: () => tx.coverageCapability.findUnique(where),
    COMMISSION_AGREEMENT: () => tx.commissionAgreement.findUnique(where),
    COMMISSION_SCHEDULE: () => tx.commissionSchedule.findUnique(where),
    DOCUMENT: () => tx.document.findUnique(where),
  };
  return !!(await finders[type]());
}

export function writePermissionFor(type: RecordType): PermissionCode {
  if (type.startsWith("APPETITE") || type === "UNDERWRITING_REQUIREMENT" || type === "COVERAGE_CAPABILITY") return "appetite.write";
  if (type.startsWith("COMMISSION")) return "commission.write";
  if (type.startsWith("CONTACT")) return "contact.write";
  if (type.startsWith("AGENCY") || type === "CARRIER_PORTAL") return "appointment.write";
  if (type === "DOCUMENT") return "document.write";
  return "carrier.write";
}

const sourceSchema = z
  .object({
    recordType: z.enum(RecordType),
    recordId: z.uuid(),
    sourceKind: z.enum(["DOCUMENT", "USER_ENTERED"]),
    documentVersionId: optionalId,
    pageOrSection: optionalText(120),
    sourceNote: optionalText(1000),
  })
  .refine((s) => s.sourceKind !== "DOCUMENT" || !!s.documentVersionId, { message: "Choose the document", path: ["documentVersionId"] })
  .refine((s) => s.sourceKind !== "USER_ENTERED" || !!s.sourceNote, { message: "Say where this came from (e.g. call with the underwriter on a date)", path: ["sourceNote"] });

/** Staff add DOCUMENT or USER_ENTERED sources. IMPORT and AI_EXTRACTED sources come from their own pipelines. */
export async function addSource(ctx: AuthContext, input: unknown, tx?: Tx) {
  const data = parse(sourceSchema, input);
  assertCan(ctx, writePermissionFor(data.recordType));
  const run = async (t: Tx) => {
    if (!(await recordExists(t, data.recordType, data.recordId))) throw new ValidationError("That record doesn't exist.");
    if (data.documentVersionId) {
      const v = await t.documentVersion.findUnique({ where: { id: data.documentVersionId }, include: { document: true } });
      if (!v || v.document.status !== "ACTIVE") throw new ValidationError("Document not found.");
      if (v.document.classification === "RESTRICTED") assertCan(ctx, "commission.read");
    }
    const row = await t.recordSource.create({
      data: {
        recordType: data.recordType,
        recordId: data.recordId,
        sourceKind: data.sourceKind,
        documentVersionId: data.sourceKind === "DOCUMENT" ? data.documentVersionId! : null,
        pageOrSection: data.pageOrSection ?? null,
        sourceNote: data.sourceNote ?? null,
        createdById: ctx.userId,
      },
    });
    await recordAudit(t, ctx, { action: "source.add", entityType: "record_source", entityId: row.id, after: row });
    return row;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export async function listSources(ctx: AuthContext, recordType: RecordType, recordId: string) {
  assertCan(ctx, "document.read");
  return prisma.recordSource.findMany({
    where: { recordType, recordId },
    orderBy: { createdAt: "asc" },
    include: {
      createdBy: { select: { name: true } },
      documentVersion: { select: { id: true, versionNumber: true, document: { select: { id: true, title: true } } } },
      importJob: { select: { id: true, sourceFilename: true } },
    },
  });
}

export async function hasSource(tx: Tx, recordType: RecordType, recordId: string): Promise<boolean> {
  return (await tx.recordSource.count({ where: { recordType, recordId } })) > 0;
}
