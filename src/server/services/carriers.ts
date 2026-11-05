import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import {
  AccessStatus,
  ActivityType,
  DistributionType,
  OrganizationRelationshipType,
  OrganizationStatus,
  OrganizationType,
} from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { optionalDate, optionalId, optionalText, optionalUrl, parse, requiredText } from "@/server/validation";

/**
 * Carrier directory. A "carrier" here is any market organization: insurers, groups,
 * MGAs/MGUs, wholesalers, program administrators, general agencies. AGENCY organizations
 * (TIG's own legal entities) are not carriers and are never returned.
 */
export const CARRIER_TYPES = Object.values(OrganizationType).filter((t) => t !== "AGENCY") as Exclude<OrganizationType, "AGENCY">[];
const INTERMEDIARY_TYPES: OrganizationType[] = ["MGA", "MGU", "WHOLESALER", "PROGRAM_ADMIN", "GENERAL_AGENCY", "OTHER"];
const NEEDS_INTERMEDIARY: DistributionType[] = ["WHOLESALE", "MGA", "PROGRAM"];

const carrierType = z.enum(CARRIER_TYPES as [string, ...string[]]).transform((t) => t as Exclude<OrganizationType, "AGENCY">);

// ───────────────────────────── Reads ─────────────────────────────

const listSchema = z.object({
  q: optionalText(100),
  type: z.preprocess((v) => (v === "" ? undefined : v), carrierType.optional()),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(OrganizationStatus).optional()),
  ownerUserId: optionalId,
  parentId: optionalId,
  lineId: optionalId,
  includeArchived: z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean()).default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CarrierListFilters = z.input<typeof listSchema>;

export async function listCarriers(ctx: AuthContext, filters: CarrierListFilters = {}) {
  assertCan(ctx, "carrier.read");
  const f = parse(listSchema, filters);
  const where: Prisma.OrganizationWhereInput = {
    type: f.type ?? { not: "AGENCY" },
    ...(f.status && { status: f.status }),
    ...(f.ownerUserId && { ownerUserId: f.ownerUserId }),
    ...(f.parentId && { parentId: f.parentId }),
    ...(!f.includeArchived && { archivedAt: null }),
    ...(f.lineId && { carrierProducts: { some: { archivedAt: null, product: { lineId: f.lineId } } } }),
    ...(f.q && {
      OR: [
        { displayName: { contains: f.q, mode: "insensitive" } },
        { legalName: { contains: f.q, mode: "insensitive" } },
        { identifiers: { some: { value: { equals: f.q, mode: "insensitive" } } } },
      ],
    }),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        parent: { select: { id: true, displayName: true } },
        owner: { select: { id: true, name: true } },
        carrierProducts: { where: { archivedAt: null }, select: { product: { select: { line: { select: { name: true } } } } } },
      },
    }),
  ]);
  return {
    total,
    page: f.page,
    pageSize: f.pageSize,
    items: rows.map((o) => ({
      id: o.id,
      displayName: o.displayName,
      legalName: o.legalName,
      type: o.type,
      status: o.status,
      archivedAt: o.archivedAt,
      parent: o.parent,
      owner: o.owner,
      lines: [...new Set(o.carrierProducts.map((p) => p.product.line.name))].sort(),
      updatedAt: o.updatedAt,
    })),
  };
}

async function findCarrier(tx: Prisma.TransactionClient, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Carrier not found.");
  const org = await tx.organization.findUnique({ where: { id } });
  if (!org || org.type === "AGENCY") throw new NotFoundError("Carrier not found.");
  return org;
}

export async function getCarrier(ctx: AuthContext, id: string) {
  assertCan(ctx, "carrier.read");
  await findCarrier(prisma, id);
  return prisma.organization.findUniqueOrThrow({
    where: { id },
    include: {
      parent: { select: { id: true, displayName: true, archivedAt: true } },
      children: { where: { type: { not: "AGENCY" } }, select: { id: true, displayName: true, type: true, archivedAt: true }, orderBy: { displayName: "asc" } },
      owner: { select: { id: true, name: true } },
      identifiers: { orderBy: { type: "asc" } },
      relationshipsOut: { include: { toOrg: { select: { id: true, displayName: true, type: true } } }, orderBy: { createdAt: "asc" } },
      relationshipsIn: { include: { fromOrg: { select: { id: true, displayName: true, type: true } } }, orderBy: { createdAt: "asc" } },
      carrierProducts: {
        orderBy: { createdAt: "asc" },
        include: {
          product: { include: { line: true } },
          channels: { orderBy: { createdAt: "asc" }, include: { intermediary: { select: { id: true, displayName: true } } } },
        },
      },
      channelsAsIntermediary: {
        where: { archivedAt: null },
        include: { carrierProduct: { include: { writingCompany: { select: { id: true, displayName: true } }, product: { select: { name: true } } } } },
      },
    },
  });
}

/** Lightweight list for pickers (parent group, relationship target, intermediary). */
export async function listCarrierOptions(ctx: AuthContext, opts: { types?: OrganizationType[] } = {}) {
  assertCan(ctx, "carrier.read");
  return prisma.organization.findMany({
    where: { type: opts.types ? { in: opts.types } : { not: "AGENCY" }, archivedAt: null },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, type: true },
  });
}

export async function listLines(ctx: AuthContext) {
  assertCan(ctx, "carrier.read");
  return prisma.lineOfBusiness.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, code: true } });
}

export async function listProducts(ctx: AuthContext) {
  assertCan(ctx, "carrier.read");
  return prisma.insuranceProduct.findMany({ orderBy: [{ line: { sortOrder: "asc" } }, { name: "asc" }], select: { id: true, name: true, line: { select: { name: true } } } });
}

export async function listActivity(ctx: AuthContext, carrierId: string) {
  assertCan(ctx, "carrier.read");
  await findCarrier(prisma, carrierId);
  return prisma.relationshipActivity.findMany({
    where: { organizationId: carrierId },
    orderBy: { occurredAt: "desc" },
    include: { owner: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } },
  });
}

/** Audit history for the carrier and the records that hang off it. */
export async function listCarrierHistory(ctx: AuthContext, carrierId: string) {
  assertCan(ctx, "carrier.read");
  assertCan(ctx, "audit.read");
  await findCarrier(prisma, carrierId);
  const viaChannel = { marketChannel: { OR: [{ carrierProduct: { writingCompanyId: carrierId } }, { intermediaryOrgId: carrierId }] } };
  // Sequential on purpose: local PGlite is unstable with concurrent queries (DECISIONS D7a).
  const groups = [
    await prisma.organizationRelationship.findMany({ where: { OR: [{ fromOrgId: carrierId }, { toOrgId: carrierId }] }, select: { id: true } }),
    await prisma.organizationIdentifier.findMany({ where: { organizationId: carrierId }, select: { id: true } }),
    await prisma.carrierProduct.findMany({ where: { writingCompanyId: carrierId }, select: { id: true } }),
    await prisma.marketChannel.findMany({ where: { OR: [{ carrierProduct: { writingCompanyId: carrierId } }, { intermediaryOrgId: carrierId }] }, select: { id: true } }),
    await prisma.relationshipActivity.findMany({ where: { organizationId: carrierId }, select: { id: true } }),
    await prisma.agencyAppointment.findMany({ where: viaChannel, select: { id: true } }),
    await prisma.agencyCode.findMany({ where: { appointment: viaChannel }, select: { id: true } }),
    await prisma.appointmentAuthorization.findMany({ where: { appointment: viaChannel }, select: { id: true } }),
    await prisma.carrierPortal.findMany({ where: { organizationId: carrierId }, select: { id: true } }),
    await prisma.contactAssignment.findMany({ where: { organizationId: carrierId }, select: { id: true } }),
  ];
  const ids = [carrierId, ...groups.flat().map((r) => r.id)];
  // Identifier deletions keep the carrier id in after_state, so match those too.
  return prisma.auditEvent.findMany({
    where: { OR: [{ entityId: { in: ids } }, { afterState: { path: ["organizationId"], equals: carrierId } }, { beforeState: { path: ["organizationId"], equals: carrierId } }] },
    orderBy: { occurredAt: "desc" },
    take: 500,
    include: { actor: { select: { name: true } } },
  });
}

// ───────────────────────────── Writes ─────────────────────────────

const carrierFields = {
  legalName: requiredText(200),
  displayName: requiredText(120),
  type: carrierType,
  status: z.enum(OrganizationStatus).default("ACTIVE"),
  parentId: optionalId,
  ownerUserId: optionalId,
  website: optionalUrl,
};
const createSchema = z.object(carrierFields);
const updateSchema = z.object({
  legalName: carrierFields.legalName.optional(),
  displayName: carrierFields.displayName.optional(),
  type: carrierType.optional(),
  status: z.enum(OrganizationStatus).optional(),
  parentId: optionalId,
  ownerUserId: optionalId,
  website: optionalUrl,
});

async function checkParent(tx: Prisma.TransactionClient, selfId: string | null, parentId: string | null | undefined) {
  if (!parentId) return;
  let cursor: string | null = parentId;
  for (let depth = 0; cursor; depth++) {
    if (cursor === selfId) throw new ValidationError("A carrier can't be its own parent (directly or through its group).");
    if (depth > 20) throw new ValidationError("Parent chain is too deep.");
    const p: { type: OrganizationType; parentId: string | null } | null = await tx.organization.findUnique({ where: { id: cursor }, select: { type: true, parentId: true } });
    if (!p || p.type === "AGENCY") throw new ValidationError("Parent carrier not found.");
    cursor = p.parentId;
  }
}

async function checkOwner(tx: Prisma.TransactionClient, ownerUserId: string | null | undefined) {
  if (!ownerUserId) return;
  const u = await tx.user.findUnique({ where: { id: ownerUserId }, select: { status: true } });
  if (!u || u.status !== "ACTIVE") throw new ValidationError("Owner must be an active user.");
}

export async function createCarrier(ctx: AuthContext, input: unknown) {
  assertCan(ctx, "carrier.write");
  const data = parse(createSchema, input);
  return prisma.$transaction(async (tx) => {
    await checkParent(tx, null, data.parentId);
    await checkOwner(tx, data.ownerUserId);
    const org = await tx.organization.create({ data: { ...data, parentId: data.parentId ?? null, ownerUserId: data.ownerUserId ?? null, website: data.website ?? null } });
    await recordAudit(tx, ctx, { action: "carrier.create", entityType: "organization", entityId: org.id, after: org });
    return org;
  });
}

export async function updateCarrier(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "carrier.write");
  const data = parse(updateSchema, input);
  return prisma.$transaction(async (tx) => {
    const before = await findCarrier(tx, id);
    if (data.parentId !== undefined) await checkParent(tx, id, data.parentId);
    if (data.ownerUserId !== undefined) await checkOwner(tx, data.ownerUserId);
    const after = await tx.organization.update({ where: { id }, data });
    await recordAudit(tx, ctx, { action: "carrier.update", entityType: "organization", entityId: id, before, after });
    return after;
  });
}

/** Soft archive: history and references stay; archived carriers drop out of default lists. */
export async function setCarrierArchived(ctx: AuthContext, id: string, archived: boolean) {
  assertCan(ctx, "carrier.write");
  return prisma.$transaction(async (tx) => {
    const before = await findCarrier(tx, id);
    if (!!before.archivedAt === archived) return before;
    const after = await tx.organization.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await recordAudit(tx, ctx, { action: archived ? "carrier.archive" : "carrier.restore", entityType: "organization", entityId: id, before, after });
    return after;
  });
}

// Identifiers (NAIC, FEIN, AM Best id...)

const identifierSchema = z.object({
  type: z.string().trim().toUpperCase().pipe(z.string().min(1).max(40).regex(/^[A-Z0-9_]+$/, "Use letters, digits and _")),
  value: requiredText(80),
  jurisdiction: optionalText(40),
});

export async function addIdentifier(ctx: AuthContext, carrierId: string, input: unknown) {
  assertCan(ctx, "carrier.write");
  const data = parse(identifierSchema, input);
  try {
    return await prisma.$transaction(async (tx) => {
      await findCarrier(tx, carrierId);
      const row = await tx.organizationIdentifier.create({ data: { organizationId: carrierId, type: data.type, value: data.value, jurisdiction: data.jurisdiction ?? null } });
      await recordAudit(tx, ctx, { action: "carrier.identifier.add", entityType: "organization_identifier", entityId: row.id, after: row });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`${data.type} ${data.value} is already recorded on another carrier.`);
    throw e;
  }
}

export async function removeIdentifier(ctx: AuthContext, carrierId: string, identifierId: string) {
  assertCan(ctx, "carrier.write");
  return prisma.$transaction(async (tx) => {
    const row = await tx.organizationIdentifier.findFirst({ where: { id: identifierId, organizationId: carrierId } });
    if (!row) throw new NotFoundError("Identifier not found.");
    await tx.organizationIdentifier.delete({ where: { id: row.id } });
    await recordAudit(tx, ctx, { action: "carrier.identifier.remove", entityType: "organization_identifier", entityId: row.id, before: row });
  });
}

// Relationships between organizations (group membership, MGA/wholesaler for...)

const relationshipSchema = z
  .object({
    toOrgId: z.uuid(),
    relationshipType: z.enum(OrganizationRelationshipType),
    effectiveFrom: optionalDate,
    effectiveTo: optionalDate,
  })
  .refine((r) => !r.effectiveFrom || !r.effectiveTo || r.effectiveTo >= r.effectiveFrom, { message: "End date must be on or after the start date", path: ["effectiveTo"] });

export async function addRelationship(ctx: AuthContext, fromOrgId: string, input: unknown) {
  assertCan(ctx, "carrier.write");
  const data = parse(relationshipSchema, input);
  if (data.toOrgId === fromOrgId) throw new ValidationError("A carrier can't have a relationship with itself.");
  return prisma.$transaction(async (tx) => {
    await findCarrier(tx, fromOrgId);
    await findCarrier(tx, data.toOrgId);
    const row = await tx.organizationRelationship.create({ data: { fromOrgId, ...data, effectiveFrom: data.effectiveFrom ?? null, effectiveTo: data.effectiveTo ?? null } });
    await recordAudit(tx, ctx, { action: "carrier.relationship.add", entityType: "organization_relationship", entityId: row.id, after: row });
    return row;
  });
}

/** Ends a relationship by setting its end date. Rows are kept for history. */
export async function endRelationship(ctx: AuthContext, carrierId: string, relationshipId: string, input: unknown) {
  assertCan(ctx, "carrier.write");
  const { effectiveTo } = parse(z.object({ effectiveTo: optionalDate }), input);
  if (!effectiveTo) throw new ValidationError("End date is required.");
  return prisma.$transaction(async (tx) => {
    const before = await tx.organizationRelationship.findFirst({ where: { id: relationshipId, OR: [{ fromOrgId: carrierId }, { toOrgId: carrierId }] } });
    if (!before) throw new NotFoundError("Relationship not found.");
    if (before.effectiveFrom && effectiveTo < before.effectiveFrom) throw new ValidationError("End date must be on or after the start date.");
    const after = await tx.organizationRelationship.update({ where: { id: before.id }, data: { effectiveTo } });
    await recordAudit(tx, ctx, { action: "carrier.relationship.end", entityType: "organization_relationship", entityId: before.id, before, after });
    return after;
  });
}

// Writing companies & channels

const productSchema = z
  .object({
    productId: optionalId,
    newProductLineId: optionalId,
    newProductName: optionalText(120),
    programName: optionalText(120),
  })
  .refine((p) => !!p.productId !== !!(p.newProductLineId && p.newProductName), { message: "Choose an existing product, or give a line and name for a new one" });

export async function addCarrierProduct(ctx: AuthContext, carrierId: string, input: unknown) {
  assertCan(ctx, "carrier.write");
  const data = parse(productSchema, input);
  return prisma.$transaction(async (tx) => {
    const carrier = await findCarrier(tx, carrierId);
    if (!["INSURER", "OTHER"].includes(carrier.type)) throw new ValidationError("Only an insurer (writing company) can write a product. Add intermediaries as channels.");
    let productId = data.productId ?? null;
    if (!productId) {
      const code = data.newProductName!.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
      const existing = await tx.insuranceProduct.findUnique({ where: { lineId_code: { lineId: data.newProductLineId!, code } } });
      const product = existing ?? (await tx.insuranceProduct.create({ data: { lineId: data.newProductLineId!, code, name: data.newProductName! } }));
      if (!existing) await recordAudit(tx, ctx, { action: "product.create", entityType: "insurance_product", entityId: product.id, after: product });
      productId = product.id;
    }
    const row = await tx.carrierProduct.create({ data: { writingCompanyId: carrierId, productId, programName: data.programName ?? null } });
    await recordAudit(tx, ctx, { action: "carrier.product.add", entityType: "carrier_product", entityId: row.id, after: row });
    return row;
  });
}

const channelSchema = z.object({
  distributionType: z.enum(DistributionType),
  intermediaryOrgId: optionalId,
  accessStatus: z.enum(AccessStatus).default("UNKNOWN"),
});

export async function addChannel(ctx: AuthContext, carrierId: string, carrierProductId: string, input: unknown) {
  assertCan(ctx, "carrier.write");
  const data = parse(channelSchema, input);
  if (data.distributionType === "DIRECT" && data.intermediaryOrgId) throw new ValidationError("A direct channel has no intermediary.");
  if (NEEDS_INTERMEDIARY.includes(data.distributionType) && !data.intermediaryOrgId) throw new ValidationError("Choose the intermediary for this channel.");
  return prisma.$transaction(async (tx) => {
    const cp = await tx.carrierProduct.findFirst({ where: { id: carrierProductId, writingCompanyId: carrierId } });
    if (!cp) throw new NotFoundError("Product not found on this carrier.");
    if (data.intermediaryOrgId) {
      const inter = await findCarrier(tx, data.intermediaryOrgId);
      if (!INTERMEDIARY_TYPES.includes(inter.type)) throw new ValidationError("The intermediary must be an MGA, MGU, wholesaler, program administrator or general agency.");
    }
    const row = await tx.marketChannel.create({ data: { carrierProductId, distributionType: data.distributionType, intermediaryOrgId: data.intermediaryOrgId ?? null, accessStatus: data.accessStatus } });
    await recordAudit(tx, ctx, { action: "carrier.channel.add", entityType: "market_channel", entityId: row.id, after: row });
    return row;
  });
}

export async function setCarrierProductArchived(ctx: AuthContext, carrierId: string, carrierProductId: string, archived: boolean) {
  assertCan(ctx, "carrier.write");
  return prisma.$transaction(async (tx) => {
    const before = await tx.carrierProduct.findFirst({ where: { id: carrierProductId, writingCompanyId: carrierId } });
    if (!before) throw new NotFoundError("Product not found on this carrier.");
    const after = await tx.carrierProduct.update({ where: { id: before.id }, data: { archivedAt: archived ? new Date() : null } });
    await recordAudit(tx, ctx, { action: archived ? "carrier.product.archive" : "carrier.product.restore", entityType: "carrier_product", entityId: before.id, before, after });
  });
}

export async function setChannelArchived(ctx: AuthContext, carrierId: string, channelId: string, archived: boolean) {
  assertCan(ctx, "carrier.write");
  return prisma.$transaction(async (tx) => {
    const before = await tx.marketChannel.findFirst({ where: { id: channelId, carrierProduct: { writingCompanyId: carrierId } } });
    if (!before) throw new NotFoundError("Channel not found on this carrier.");
    const after = await tx.marketChannel.update({ where: { id: before.id }, data: { archivedAt: archived ? new Date() : null } });
    await recordAudit(tx, ctx, { action: archived ? "carrier.channel.archive" : "carrier.channel.restore", entityType: "market_channel", entityId: before.id, before, after });
  });
}

// Activity notes

const noteSchema = z.object({
  type: z.enum(ActivityType).default("NOTE"),
  notes: requiredText(5000),
  occurredAt: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.date().optional()),
});

export async function addActivity(ctx: AuthContext, carrierId: string, input: unknown) {
  assertCan(ctx, "carrier.write");
  const data = parse(noteSchema, input);
  return prisma.$transaction(async (tx) => {
    await findCarrier(tx, carrierId);
    const row = await tx.relationshipActivity.create({
      data: { organizationId: carrierId, ownerUserId: ctx.userId, type: data.type, notes: data.notes, occurredAt: data.occurredAt ?? new Date() },
    });
    await recordAudit(tx, ctx, { action: "carrier.activity.add", entityType: "relationship_activity", entityId: row.id, after: row });
    return row;
  });
}

function isUniqueViolation(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return true;
  const cause = (e as { cause?: { code?: string }; meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } }) ?? {};
  return cause.cause?.code === "23505" || cause.meta?.driverAdapterError?.cause?.originalCode === "23505";
}
