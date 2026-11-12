import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { ActiveStatus, ActivityType, ContactRole } from "@/generated/prisma/enums";
import { addDays, freshness, todayUtc } from "@/lib/dates";
import { recordAudit } from "@/server/audit";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/server/errors";
import { optionalDate, optionalId, optionalText, parse, requiredText } from "@/server/validation";
import { numberSetting, SETTING } from "./settings";

/**
 * Underwriter and marketing-rep directory (PRD screen 5, P0-03, P0-12).
 * A contact can hold several assignments: organization, optional channel, territory,
 * role and specialties. Ended assignments are kept (effective_to), never deleted.
 */

type Tx = Prisma.TransactionClient;

const currentAssignment = (today: Date): Prisma.ContactAssignmentWhereInput => ({
  AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] }, { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }],
});

async function findContact(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Contact not found.");
  const c = await tx.contact.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Contact not found.");
  return c;
}

async function findMarketOrg(tx: Tx, id: string) {
  const org = await tx.organization.findUnique({ where: { id } });
  if (!org || org.type === "AGENCY") throw new ValidationError("Carrier not found.");
  return org;
}

// ───────────────────────────── Reads ─────────────────────────────

const listSchema = z.object({
  q: optionalText(100),
  organizationId: optionalId,
  role: z.preprocess((v) => (v === "" ? undefined : v), z.enum(ContactRole).optional()),
  stateCode: z.preprocess((v) => (v === "" ? undefined : typeof v === "string" ? v.toUpperCase() : v), z.string().length(2).optional()),
  lineId: optionalId,
  freshness: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["stale", "fresh"]).optional()),
  includeInactive: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ContactFilters = z.input<typeof listSchema>;

/**
 * "Who's my rep for X in Y": filter by carrier, role, state and line. A state filter matches
 * assignments for that state or for the whole US; an assignment with no territory is
 * "not stated" and does not match a state filter.
 */
export async function listContacts(ctx: AuthContext, filters: ContactFilters = {}) {
  assertCan(ctx, "contact.read");
  const f = parse(listSchema, filters);
  const today = todayUtc();
  const cadence = await numberSetting(SETTING.contactReviewDays);
  const staleBefore = addDays(new Date(), -cadence);

  const assignmentFilter: Prisma.ContactAssignmentWhereInput = {
    ...currentAssignment(today),
    ...(f.organizationId && { organizationId: f.organizationId }),
    ...(f.role && { role: f.role }),
    ...(f.stateCode && { territory: { OR: [{ stateCode: f.stateCode }, { territoryType: "COUNTRY", countryCode: "US" }] } }),
    ...(f.lineId && { specialties: { some: { product: { lineId: f.lineId } } } }),
  };
  const filtered = !!(f.organizationId || f.role || f.stateCode || f.lineId);
  const where: Prisma.ContactWhereInput = {
    archivedAt: null,
    ...(!f.includeInactive && { status: "ACTIVE" }),
    ...(filtered && { assignments: { some: assignmentFilter } }),
    ...(f.freshness === "stale" && { OR: [{ verifiedAt: null }, { verifiedAt: { lte: staleBefore } }] }),
    ...(f.freshness === "fresh" && { verifiedAt: { gt: staleBefore } }),
    ...(f.q && {
      AND: [{
        OR: [
          { firstName: { contains: f.q, mode: "insensitive" } },
          { lastName: { contains: f.q, mode: "insensitive" } },
          { email: { contains: f.q, mode: "insensitive" } },
          ...(f.q.includes(" ") ? [{ AND: [{ firstName: { contains: f.q.split(" ")[0], mode: "insensitive" as const } }, { lastName: { contains: f.q.split(" ").slice(1).join(" "), mode: "insensitive" as const } }] }] : []),
        ],
      }],
    }),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        assignments: {
          where: filtered ? assignmentFilter : currentAssignment(today),
          include: {
            organization: { select: { id: true, displayName: true } },
            territory: { select: { name: true, stateCode: true } },
            specialties: { include: { product: { select: { name: true, line: { select: { name: true } } } } } },
          },
        },
      },
    }),
  ]);
  return {
    total,
    page: f.page,
    pageSize: f.pageSize,
    cadenceDays: cadence,
    items: rows.map((c) => ({ ...c, freshness: freshness(c.verifiedAt, cadence) })),
  };
}

export async function getContact(ctx: AuthContext, id: string) {
  assertCan(ctx, "contact.read");
  await findContact(prisma, id);
  const cadence = await numberSetting(SETTING.contactReviewDays);
  const contact = await prisma.contact.findUniqueOrThrow({
    where: { id },
    include: {
      assignments: {
        orderBy: [{ effectiveTo: { sort: "desc", nulls: "first" } }, { createdAt: "asc" }],
        include: {
          organization: { select: { id: true, displayName: true, type: true } },
          marketChannel: { include: { intermediary: { select: { displayName: true } }, carrierProduct: { include: { product: { select: { name: true } }, writingCompany: { select: { displayName: true } } } } } },
          territory: true,
          backupContact: { select: { id: true, firstName: true, lastName: true } },
          specialties: { include: { product: { include: { line: true } } } },
        },
      },
      backupFor: { include: { contact: { select: { id: true, firstName: true, lastName: true } }, organization: { select: { displayName: true } } } },
    },
  });
  const verifications = await prisma.verificationEvent.findMany({
    where: { recordType: "CONTACT", recordId: id },
    orderBy: { verifiedAt: "desc" },
    take: 20,
    include: { verifiedBy: { select: { name: true } } },
  });
  const today = todayUtc();
  return {
    ...contact,
    freshness: freshness(contact.verifiedAt, cadence),
    cadenceDays: cadence,
    verifications,
    assignments: contact.assignments.map((a) => ({ ...a, current: (!a.effectiveFrom || a.effectiveFrom <= today) && (!a.effectiveTo || a.effectiveTo >= today) })),
  };
}

/** Contacts with an assignment at a carrier, for the carrier's Contacts tab. */
export async function listContactsForCarrier(ctx: AuthContext, organizationId: string) {
  assertCan(ctx, "contact.read");
  const cadence = await numberSetting(SETTING.contactReviewDays);
  const rows = await prisma.contactAssignment.findMany({
    where: { organizationId, contact: { archivedAt: null } },
    orderBy: [{ contact: { lastName: "asc" } }],
    include: {
      contact: true,
      territory: { select: { name: true } },
      marketChannel: { select: { distributionType: true, intermediary: { select: { displayName: true } } } },
      specialties: { include: { product: { select: { name: true } } } },
    },
  });
  const today = todayUtc();
  return rows.map((a) => ({
    ...a,
    current: (!a.effectiveFrom || a.effectiveFrom <= today) && (!a.effectiveTo || a.effectiveTo >= today),
    freshness: freshness(a.contact.verifiedAt, cadence),
  }));
}

export async function listContactOptions(ctx: AuthContext) {
  assertCan(ctx, "contact.read");
  return prisma.contact.findMany({ where: { archivedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true } });
}

export async function listTerritories(ctx: AuthContext) {
  assertCan(ctx, "contact.read");
  return prisma.territory.findMany({ where: { countryCode: "US", territoryType: { in: ["COUNTRY", "STATE"] } }, orderBy: [{ territoryType: "asc" }, { name: "asc" }], select: { id: true, name: true, stateCode: true, territoryType: true } });
}

export async function listContactActivity(ctx: AuthContext, contactId: string) {
  assertCan(ctx, "contact.read");
  await findContact(prisma, contactId);
  return prisma.relationshipActivity.findMany({
    where: { contactId },
    orderBy: { occurredAt: "desc" },
    include: { owner: { select: { name: true } }, organization: { select: { id: true, displayName: true } } },
  });
}

export async function listContactHistory(ctx: AuthContext, contactId: string) {
  assertCan(ctx, "contact.read");
  assertCan(ctx, "audit.read");
  await findContact(prisma, contactId);
  const assignments = await prisma.contactAssignment.findMany({ where: { contactId }, select: { id: true, specialties: { select: { id: true } } } });
  const ids = [contactId, ...assignments.map((a) => a.id), ...assignments.flatMap((a) => a.specialties.map((s) => s.id))];
  return prisma.auditEvent.findMany({
    where: { OR: [{ entityId: { in: ids } }, { beforeState: { path: ["contactId"], equals: contactId } }] },
    orderBy: { occurredAt: "desc" },
    take: 500,
    include: { actor: { select: { name: true } } },
  });
}

// ───────────────────────────── Writes ─────────────────────────────

const phone = optionalText(40);
const contactFields = z.object({
  firstName: requiredText(80),
  lastName: requiredText(80),
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim().toLowerCase() : v), z.email().max(200).optional()),
  officePhone: phone,
  mobilePhone: phone,
  status: z.enum(ActiveStatus).default("ACTIVE"),
});

export async function createContact(ctx: AuthContext, input: unknown) {
  assertCan(ctx, "contact.write");
  const data = parse(contactFields, input);
  return prisma.$transaction(async (tx) => {
    const c = await tx.contact.create({ data: { ...data, email: data.email ?? null, officePhone: data.officePhone ?? null, mobilePhone: data.mobilePhone ?? null } });
    await recordAudit(tx, ctx, { action: "contact.create", entityType: "contact", entityId: c.id, after: c });
    return c;
  });
}

const carrierContactSchema = contactFields.omit({ status: true }).extend({ role: z.enum(ContactRole), title: optionalText(120), territoryId: optionalId });

/** A new contact and their place at a carrier (type, title, territory), in one step from the carrier's Contacts tab. */
export async function addContactToCarrier(ctx: AuthContext, organizationId: string, input: unknown) {
  assertCan(ctx, "contact.write");
  const d = parse(carrierContactSchema, input);
  return prisma.$transaction(async (tx) => {
    const c = await tx.contact.create({ data: { firstName: d.firstName, lastName: d.lastName, email: d.email ?? null, officePhone: d.officePhone ?? null, mobilePhone: d.mobilePhone ?? null } });
    await checkAssignmentRefs(tx, c.id, { organizationId, territoryId: d.territoryId });
    const a = await tx.contactAssignment.create({ data: { contactId: c.id, organizationId, role: d.role, title: d.title ?? null, territoryId: d.territoryId ?? null } });
    await recordAudit(tx, ctx, { action: "contact.create", entityType: "contact", entityId: c.id, after: c });
    await recordAudit(tx, ctx, { action: "contact.assignment.add", entityType: "contact_assignment", entityId: a.id, after: a });
    return { contact: c, assignment: a };
  });
}

export async function updateContact(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "contact.write");
  const data = parse(contactFields.partial(), input);
  // Only fields present in the input change; a blank optional field clears it.
  const raw = (input ?? {}) as Record<string, unknown>;
  const patch: Prisma.ContactUpdateInput = {};
  if (data.firstName !== undefined) patch.firstName = data.firstName;
  if (data.lastName !== undefined) patch.lastName = data.lastName;
  if (data.status !== undefined && "status" in raw) patch.status = data.status;
  for (const k of ["email", "officePhone", "mobilePhone"] as const) if (k in raw) patch[k] = data[k] ?? null;
  return prisma.$transaction(async (tx) => {
    const before = await findContact(tx, id);
    const after = await tx.contact.update({ where: { id }, data: patch });
    await recordAudit(tx, ctx, { action: "contact.update", entityType: "contact", entityId: id, before, after });
    return after;
  });
}

export async function setContactArchived(ctx: AuthContext, id: string, archived: boolean) {
  assertCan(ctx, "contact.write");
  return prisma.$transaction(async (tx) => {
    const before = await findContact(tx, id);
    const after = await tx.contact.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await recordAudit(tx, ctx, { action: archived ? "contact.archive" : "contact.restore", entityType: "contact", entityId: id, before, after });
    return after;
  });
}

/** "Confirm still current": records who checked, when, how, and the next review date. */
export async function verifyContact(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "contact.write");
  const { sourceNote } = parse(z.object({ sourceNote: requiredText(500) }), input);
  const cadence = await numberSetting(SETTING.contactReviewDays);
  return prisma.$transaction(async (tx) => {
    const before = await findContact(tx, id);
    const now = new Date();
    const event = await tx.verificationEvent.create({
      data: { recordType: "CONTACT", recordId: id, verifiedById: ctx.userId, verifiedAt: now, nextReviewAt: addDays(now, cadence), sourceNote },
    });
    const after = await tx.contact.update({ where: { id }, data: { verifiedAt: now } });
    await recordAudit(tx, ctx, { action: "contact.verify", entityType: "contact", entityId: id, before: { verifiedAt: before.verifiedAt }, after: { verifiedAt: after.verifiedAt, nextReviewAt: event.nextReviewAt, sourceNote } });
    return event;
  });
}

const assignmentSchema = z
  .object({
    organizationId: z.uuid(),
    marketChannelId: optionalId,
    territoryId: optionalId,
    role: z.enum(ContactRole),
    title: optionalText(120),
    authorityNotes: optionalText(2000),
    backupContactId: optionalId,
    effectiveFrom: optionalDate,
    effectiveTo: optionalDate,
  })
  .refine((a) => !a.effectiveFrom || !a.effectiveTo || a.effectiveTo >= a.effectiveFrom, { message: "End date must be on or after the start date", path: ["effectiveTo"] });

async function checkAssignmentRefs(tx: Tx, contactId: string, a: { organizationId: string; marketChannelId?: string | null; territoryId?: string | null; backupContactId?: string | null }) {
  await findMarketOrg(tx, a.organizationId);
  if (a.marketChannelId) {
    const ch = await tx.marketChannel.findFirst({
      where: { id: a.marketChannelId, OR: [{ intermediaryOrgId: a.organizationId }, { carrierProduct: { writingCompanyId: a.organizationId } }] },
    });
    if (!ch) throw new ValidationError("That channel doesn't belong to this carrier.");
  }
  if (a.territoryId && !(await tx.territory.findUnique({ where: { id: a.territoryId } }))) throw new ValidationError("Territory not found.");
  if (a.backupContactId) {
    if (a.backupContactId === contactId) throw new ValidationError("A contact can't be their own backup.");
    if (!(await tx.contact.findUnique({ where: { id: a.backupContactId } }))) throw new ValidationError("Backup contact not found.");
  }
}

export async function addAssignment(ctx: AuthContext, contactId: string, input: unknown) {
  assertCan(ctx, "contact.write");
  const data = parse(assignmentSchema, input);
  return prisma.$transaction(async (tx) => {
    await findContact(tx, contactId);
    await checkAssignmentRefs(tx, contactId, data);
    const row = await tx.contactAssignment.create({
      data: {
        contactId,
        organizationId: data.organizationId,
        marketChannelId: data.marketChannelId ?? null,
        territoryId: data.territoryId ?? null,
        role: data.role,
        title: data.title ?? null,
        authorityNotes: data.authorityNotes ?? null,
        backupContactId: data.backupContactId ?? null,
        effectiveFrom: data.effectiveFrom ?? null,
        effectiveTo: data.effectiveTo ?? null,
      },
    });
    await recordAudit(tx, ctx, { action: "contact.assignment.add", entityType: "contact_assignment", entityId: row.id, after: row });
    return row;
  });
}

async function findAssignment(tx: Tx, contactId: string, assignmentId: string) {
  const a = await tx.contactAssignment.findFirst({ where: { id: assignmentId, contactId } });
  if (!a) throw new NotFoundError("Assignment not found on this contact.");
  return a;
}

const assignmentUpdate = z.object({
  title: optionalText(120),
  authorityNotes: optionalText(2000),
  backupContactId: optionalId,
});

export async function updateAssignment(ctx: AuthContext, contactId: string, assignmentId: string, input: unknown) {
  assertCan(ctx, "contact.write");
  const data = parse(assignmentUpdate, input);
  return prisma.$transaction(async (tx) => {
    const before = await findAssignment(tx, contactId, assignmentId);
    await checkAssignmentRefs(tx, contactId, { organizationId: before.organizationId, backupContactId: data.backupContactId });
    const after = await tx.contactAssignment.update({
      where: { id: assignmentId },
      data: { title: data.title ?? null, authorityNotes: data.authorityNotes ?? null, backupContactId: data.backupContactId ?? null },
    });
    await recordAudit(tx, ctx, { action: "contact.assignment.update", entityType: "contact_assignment", entityId: assignmentId, before, after });
    return after;
  });
}

export async function endAssignment(ctx: AuthContext, contactId: string, assignmentId: string, input: unknown) {
  assertCan(ctx, "contact.write");
  const { effectiveTo } = parse(z.object({ effectiveTo: optionalDate }), input);
  if (!effectiveTo) throw new ValidationError("End date is required.");
  return prisma.$transaction(async (tx) => {
    const before = await findAssignment(tx, contactId, assignmentId);
    if (before.effectiveFrom && effectiveTo < before.effectiveFrom) throw new ValidationError("End date must be on or after the start date.");
    const after = await tx.contactAssignment.update({ where: { id: assignmentId }, data: { effectiveTo } });
    await recordAudit(tx, ctx, { action: "contact.assignment.end", entityType: "contact_assignment", entityId: assignmentId, before, after });
    return after;
  });
}

export async function addSpecialty(ctx: AuthContext, contactId: string, assignmentId: string, input: unknown) {
  assertCan(ctx, "contact.write");
  const data = parse(z.object({ productId: z.uuid(), industryCode: optionalText(40) }), input);
  return prisma.$transaction(async (tx) => {
    await findAssignment(tx, contactId, assignmentId);
    if (!(await tx.insuranceProduct.findUnique({ where: { id: data.productId } }))) throw new ValidationError("Product not found.");
    const row = await tx.contactSpecialty.create({ data: { contactAssignmentId: assignmentId, productId: data.productId, industryCode: data.industryCode ?? null } });
    await recordAudit(tx, ctx, { action: "contact.specialty.add", entityType: "contact_specialty", entityId: row.id, after: { ...row, contactId } });
    return row;
  });
}

export async function removeSpecialty(ctx: AuthContext, contactId: string, specialtyId: string) {
  assertCan(ctx, "contact.write");
  return prisma.$transaction(async (tx) => {
    const row = await tx.contactSpecialty.findFirst({ where: { id: specialtyId, contactAssignment: { contactId } } });
    if (!row) throw new NotFoundError("Specialty not found on this contact.");
    await tx.contactSpecialty.delete({ where: { id: row.id } });
    await recordAudit(tx, ctx, { action: "contact.specialty.remove", entityType: "contact_specialty", entityId: row.id, before: { ...row, contactId } });
  });
}

const contactNoteSchema = z.object({
  organizationId: z.uuid(),
  type: z.enum(ActivityType).default("NOTE"),
  notes: requiredText(5000),
  occurredAt: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.date().optional()),
});

/** A note about a contact, filed under one of the carriers they work for. */
export async function addContactActivity(ctx: AuthContext, contactId: string, input: unknown) {
  assertCan(ctx, "contact.write");
  const data = parse(contactNoteSchema, input);
  return prisma.$transaction(async (tx) => {
    await findContact(tx, contactId);
    const linked = await tx.contactAssignment.findFirst({ where: { contactId, organizationId: data.organizationId } });
    if (!linked) throw new ValidationError("Choose a carrier this contact is assigned to.");
    const row = await tx.relationshipActivity.create({
      data: { organizationId: data.organizationId, contactId, ownerUserId: ctx.userId, type: data.type, notes: data.notes, occurredAt: data.occurredAt ?? new Date() },
    });
    await recordAudit(tx, ctx, { action: "contact.activity.add", entityType: "relationship_activity", entityId: row.id, after: row });
    return row;
  });
}

// ───────────────────────────── Main contacts ─────────────────────────────

/** The contact types each "Main contacts" row shows (Josh, 2026-11-12). */
export const MAIN_CONTACT_GROUPS = [
  { key: "marketing", label: "Marketing rep", empty: "No marketing rep on file", roles: ["MARKETING_REP"] },
  { key: "claims", label: "Claims", empty: "No claims contact on file", roles: ["CLAIMS_ADJUSTER", "CLAIMS_MANAGER", "CLAIMS"] },
  { key: "billing", label: "Billing", empty: "No billing contact on file", roles: ["BILLING"] },
] as const satisfies readonly { key: string; label: string; empty: string; roles: readonly ContactRole[] }[];

export type MainContact = { assignmentId: string; contactId: string; name: string; role: ContactRole; title: string | null; email: string | null; officePhone: string | null; mobilePhone: string | null; territory: string | null };

/**
 * A carrier's main contacts: its current, active marketing reps, claims contacts and billing
 * contacts, plus the carrier's own claims and billing phone lines. Every group is returned,
 * empty or not, so the page can say what isn't on file.
 */
export async function mainContacts(ctx: AuthContext, organizationId: string) {
  assertCan(ctx, "contact.read");
  if (!z.uuid().safeParse(organizationId).success) throw new NotFoundError("Carrier not found.");
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, displayName: true, type: true, claimsPhone: true, billingPhone: true } });
  if (!org || org.type === "AGENCY") throw new NotFoundError("Carrier not found.");
  const today = todayUtc();
  const rows = await prisma.contactAssignment.findMany({
    where: {
      organizationId,
      role: { in: MAIN_CONTACT_GROUPS.flatMap((g) => [...g.roles]) },
      contact: { archivedAt: null, status: "ACTIVE" },
      ...currentAssignment(today),
    },
    orderBy: [{ contact: { lastName: "asc" } }, { contact: { firstName: "asc" } }],
    include: { contact: true, territory: { select: { name: true } } },
  });
  const toCard = (a: (typeof rows)[number]): MainContact => ({
    assignmentId: a.id,
    contactId: a.contact.id,
    name: `${a.contact.firstName} ${a.contact.lastName}`,
    role: a.role,
    title: a.title,
    email: a.contact.email,
    officePhone: a.contact.officePhone,
    mobilePhone: a.contact.mobilePhone,
    territory: a.territory?.name ?? null,
  });
  return {
    carrier: { id: org.id, name: org.displayName },
    groups: MAIN_CONTACT_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      empty: g.empty,
      contacts: rows.filter((a) => (g.roles as readonly ContactRole[]).includes(a.role)).map(toCard),
      /** The carrier's own line for this group (from its details), if recorded. */
      line: g.key === "claims" ? org.claimsPhone : g.key === "billing" ? org.billingPhone : null,
    })),
  };
}
