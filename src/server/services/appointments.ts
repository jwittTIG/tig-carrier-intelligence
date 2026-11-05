import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { ActiveStatus, AgencyCodeType, AppointmentStatus } from "@/generated/prisma/enums";
import { effectiveState, todayUtc, withinParent } from "@/lib/dates";
import { recordAudit } from "@/server/audit";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { optionalDate, optionalId, optionalText, optionalUrl, parse, requiredText } from "@/server/validation";
import { numberSetting, SETTING } from "./settings";

/**
 * Agency appointments, authorizations, agency/producer codes and portal links
 * (PRD screen 6, P0-04). Appointments belong to an agency legal entity and a market channel.
 * Codes are effective-dated; overlapping ACTIVE duplicates are refused by the database.
 */

type Tx = Prisma.TransactionClient;

const channelInclude = {
  carrierProduct: { include: { writingCompany: { select: { id: true, displayName: true } }, product: { select: { id: true, name: true, line: { select: { name: true } } } } } },
  intermediary: { select: { id: true, displayName: true } },
} satisfies Prisma.MarketChannelInclude;

/** Appointments touching a carrier: on its own products' channels or through it as intermediary. */
const appointmentsForOrg = (orgId: string): Prisma.AgencyAppointmentWhereInput => ({
  marketChannel: { OR: [{ intermediaryOrgId: orgId }, { carrierProduct: { writingCompanyId: orgId } }] },
});

async function warningDays() {
  return numberSetting(SETTING.appointmentWarningDays);
}

// ───────────────────────────── Reads ─────────────────────────────

export async function listAgencyEntities(ctx: AuthContext) {
  assertCan(ctx, "appointment.read");
  return prisma.agencyEntity.findMany({ where: { status: "ACTIVE" }, include: { organization: { select: { displayName: true } } }, orderBy: { organization: { displayName: "asc" } } });
}

export async function listChannelsForOrg(ctx: AuthContext, orgId: string) {
  assertCan(ctx, "carrier.read");
  return prisma.marketChannel.findMany({
    where: { archivedAt: null, OR: [{ intermediaryOrgId: orgId }, { carrierProduct: { writingCompanyId: orgId, archivedAt: null } }] },
    include: channelInclude,
    orderBy: { createdAt: "asc" },
  });
}

export async function listAllChannels(ctx: AuthContext) {
  assertCan(ctx, "carrier.read");
  return prisma.marketChannel.findMany({
    where: { archivedAt: null, carrierProduct: { archivedAt: null } },
    include: channelInclude,
    orderBy: [{ carrierProduct: { writingCompany: { displayName: "asc" } } }, { createdAt: "asc" }],
  });
}

export function channelLabel(ch: Prisma.MarketChannelGetPayload<{ include: typeof channelInclude }>): string {
  const via = ch.intermediary ? ` via ${ch.intermediary.displayName}` : " (direct)";
  return `${ch.carrierProduct.writingCompany.displayName}: ${ch.carrierProduct.product.name}${via}`;
}

export async function listAppointmentsForCarrier(ctx: AuthContext, orgId: string) {
  assertCan(ctx, "appointment.read");
  const warn = await warningDays();
  const today = todayUtc();
  const rows = await prisma.agencyAppointment.findMany({
    where: appointmentsForOrg(orgId),
    orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }],
    include: {
      agencyEntity: { include: { organization: { select: { displayName: true } } } },
      marketChannel: { include: channelInclude },
      authorizations: { include: { territory: { select: { name: true } }, product: { select: { name: true } } } },
      codes: { orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }], include: { assignedUser: { select: { id: true, name: true } } } },
    },
  });
  return rows.map((a) => {
    const state = effectiveState(a, { today, warningDays: warn });
    return { ...a, state, codes: a.codes.map((c) => ({ ...c, state: withinParent(effectiveState(c, { today, warningDays: warn }), state) })) };
  });
}

const codeListSchema = z.object({
  q: optionalText(80),
  organizationId: optionalId,
  assignedUserId: optionalId,
  state: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["current", "expiring", "expired", "inactive"]).optional()),
});

/** All agency and producer codes, for the Codes screen and CSV export. */
export async function listAgencyCodes(ctx: AuthContext, filters: z.input<typeof codeListSchema> = {}) {
  assertCan(ctx, "appointment.read");
  const f = parse(codeListSchema, filters);
  const warn = await warningDays();
  const today = todayUtc();
  const rows = await prisma.agencyCode.findMany({
    where: {
      ...(f.q && { codeValue: { contains: f.q, mode: "insensitive" } }),
      ...(f.assignedUserId && { assignedUserId: f.assignedUserId }),
      ...(f.organizationId && { appointment: appointmentsForOrg(f.organizationId) }),
    },
    orderBy: [{ appointment: { marketChannel: { carrierProduct: { writingCompany: { displayName: "asc" } } } } }, { codeValue: "asc" }, { effectiveFrom: "desc" }],
    include: {
      assignedUser: { select: { id: true, name: true } },
      appointment: {
        include: {
          agencyEntity: { include: { organization: { select: { displayName: true } } } },
          marketChannel: { include: channelInclude },
        },
      },
    },
  });
  const withState = rows.map((c) => {
    const apptState = effectiveState(c.appointment, { today, warningDays: warn });
    const state = withinParent(effectiveState(c, { today, warningDays: warn }), apptState);
    return { ...c, state, appointmentState: apptState };
  });
  const keep = (s: string) =>
    !f.state ||
    (f.state === "current" && (s === "CURRENT" || s === "EXPIRING_SOON")) ||
    (f.state === "expiring" && s === "EXPIRING_SOON") ||
    (f.state === "expired" && s === "EXPIRED") ||
    (f.state === "inactive" && (s === "NOT_ACTIVE" || s === "NOT_YET_EFFECTIVE"));
  return withState.filter((c) => keep(c.state));
}

export async function listPortals(ctx: AuthContext, orgId: string) {
  assertCan(ctx, "appointment.read");
  return prisma.carrierPortal.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });
}

export async function listAgencyCodeHistory(ctx: AuthContext, codeId: string) {
  assertCan(ctx, "appointment.read");
  assertCan(ctx, "audit.read");
  return prisma.auditEvent.findMany({ where: { entityId: codeId }, orderBy: { occurredAt: "desc" }, include: { actor: { select: { name: true } } } });
}

// ───────────────────────────── Writes ─────────────────────────────

const appointmentSchema = z
  .object({
    agencyEntityId: z.uuid(),
    marketChannelId: z.uuid(),
    appointmentType: requiredText(80),
    status: z.enum(AppointmentStatus).default("PENDING"),
    effectiveFrom: optionalDate,
    effectiveTo: optionalDate,
  })
  .refine((r) => !r.effectiveFrom || !r.effectiveTo || r.effectiveTo >= r.effectiveFrom, { message: "End date must be on or after the start date", path: ["effectiveTo"] });

export async function createAppointment(ctx: AuthContext, input: unknown) {
  assertCan(ctx, "appointment.write");
  const data = parse(appointmentSchema, input);
  if (data.status === "ACTIVE" && !data.effectiveFrom) throw new ValidationError("An active appointment needs an effective date.");
  return prisma.$transaction(async (tx) => {
    if (!(await tx.agencyEntity.findUnique({ where: { id: data.agencyEntityId } }))) throw new ValidationError("Agency entity not found.");
    if (!(await tx.marketChannel.findUnique({ where: { id: data.marketChannelId } }))) throw new ValidationError("Channel not found.");
    const row = await tx.agencyAppointment.create({ data: { ...data, effectiveFrom: data.effectiveFrom ?? null, effectiveTo: data.effectiveTo ?? null } });
    await recordAudit(tx, ctx, { action: "appointment.create", entityType: "agency_appointment", entityId: row.id, after: row });
    return row;
  });
}

async function findAppointment(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Appointment not found.");
  const a = await tx.agencyAppointment.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Appointment not found.");
  return a;
}

const appointmentUpdate = z
  .object({ appointmentType: requiredText(80).optional(), status: z.enum(AppointmentStatus).optional(), effectiveFrom: optionalDate, effectiveTo: optionalDate });

export async function updateAppointment(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "appointment.write");
  const data = parse(appointmentUpdate, input);
  const raw = (input ?? {}) as Record<string, unknown>;
  return prisma.$transaction(async (tx) => {
    const before = await findAppointment(tx, id);
    const next = {
      appointmentType: data.appointmentType ?? before.appointmentType,
      status: data.status ?? before.status,
      effectiveFrom: "effectiveFrom" in raw ? (data.effectiveFrom ?? null) : before.effectiveFrom,
      effectiveTo: "effectiveTo" in raw ? (data.effectiveTo ?? null) : before.effectiveTo,
    };
    if (next.effectiveFrom && next.effectiveTo && next.effectiveTo < next.effectiveFrom) throw new ValidationError("End date must be on or after the start date.");
    if (next.status === "ACTIVE" && !next.effectiveFrom) throw new ValidationError("An active appointment needs an effective date.");
    const after = await tx.agencyAppointment.update({ where: { id }, data: next });
    await recordAudit(tx, ctx, { action: "appointment.update", entityType: "agency_appointment", entityId: id, before, after });
    return after;
  });
}

export async function addAuthorization(ctx: AuthContext, appointmentId: string, input: unknown) {
  assertCan(ctx, "appointment.write");
  const data = parse(z.object({ territoryId: z.uuid(), productId: z.uuid(), authorityType: requiredText(80) }), input);
  return prisma.$transaction(async (tx) => {
    const appt = await tx.agencyAppointment.findUnique({ where: { id: appointmentId }, include: { marketChannel: { include: { carrierProduct: true } } } });
    if (!appt) throw new NotFoundError("Appointment not found.");
    // The product must be written by the same writing company as the appointment's channel.
    const ok = await tx.carrierProduct.findFirst({ where: { productId: data.productId, writingCompanyId: appt.marketChannel.carrierProduct.writingCompanyId } });
    if (!ok) throw new ValidationError("That product isn't written by this carrier.");
    if (!(await tx.territory.findUnique({ where: { id: data.territoryId } }))) throw new ValidationError("Territory not found.");
    const row = await tx.appointmentAuthorization.create({ data: { appointmentId, ...data } });
    await recordAudit(tx, ctx, { action: "appointment.authorization.add", entityType: "appointment_authorization", entityId: row.id, after: row });
    return row;
  });
}

export async function removeAuthorization(ctx: AuthContext, appointmentId: string, authorizationId: string) {
  assertCan(ctx, "appointment.write");
  return prisma.$transaction(async (tx) => {
    const row = await tx.appointmentAuthorization.findFirst({ where: { id: authorizationId, appointmentId } });
    if (!row) throw new NotFoundError("Authorization not found on this appointment.");
    await tx.appointmentAuthorization.delete({ where: { id: row.id } });
    await recordAudit(tx, ctx, { action: "appointment.authorization.remove", entityType: "appointment_authorization", entityId: row.id, before: row });
  });
}

const codeSchema = z
  .object({
    codeType: z.enum(AgencyCodeType),
    codeValue: requiredText(60),
    assignedUserId: optionalId,
    effectiveFrom: z.preprocess((v) => (v === "" ? undefined : v), z.iso.date({ error: "Effective date is required" }).transform((s) => new Date(`${s}T00:00:00.000Z`))),
    effectiveTo: optionalDate,
    status: z.enum(ActiveStatus).default("ACTIVE"),
    notes: optionalText(1000),
  })
  .refine((r) => !r.effectiveTo || r.effectiveTo >= r.effectiveFrom, { message: "End date must be on or after the start date", path: ["effectiveTo"] });

function isExclusionViolation(e: unknown): boolean {
  const s = JSON.stringify(e, Object.getOwnPropertyNames(e as object)) ?? "";
  return s.includes("23P01") || s.includes("agency_codes_no_overlap_excl") || (e instanceof Error && /exclusion constraint/i.test(e.message));
}

const overlapMessage = (value: string) =>
  `Code ${value} is already active for this appointment during those dates. End the existing code first, or mark one of them inactive.`;

async function checkProducer(tx: Tx, userId: string | null | undefined) {
  if (!userId) return;
  const u = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!u || u.status === "DEACTIVATED") throw new ValidationError("Producer must be a current user.");
}

export async function addAgencyCode(ctx: AuthContext, appointmentId: string, input: unknown) {
  assertCan(ctx, "appointment.write");
  const data = parse(codeSchema, input);
  try {
    return await prisma.$transaction(async (tx) => {
      await findAppointment(tx, appointmentId);
      await checkProducer(tx, data.assignedUserId);
      const row = await tx.agencyCode.create({ data: { appointmentId, ...data, assignedUserId: data.assignedUserId ?? null, effectiveTo: data.effectiveTo ?? null, notes: data.notes ?? null } });
      await recordAudit(tx, ctx, { action: "agency_code.create", entityType: "agency_code", entityId: row.id, after: row });
      return row;
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError(overlapMessage(data.codeValue));
    throw e;
  }
}

const codeUpdate = z.object({
  assignedUserId: optionalId,
  effectiveTo: optionalDate,
  status: z.enum(ActiveStatus).optional(),
  notes: optionalText(1000),
});

/**
 * Changes who a code is assigned to, its end date, status or notes. The value, type and
 * start date don't change: issue a new code instead, so history stays readable.
 */
export async function updateAgencyCode(ctx: AuthContext, appointmentId: string, codeId: string, input: unknown) {
  assertCan(ctx, "appointment.write");
  const data = parse(codeUpdate, input);
  const raw = (input ?? {}) as Record<string, unknown>;
  let value = "";
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.agencyCode.findFirst({ where: { id: codeId, appointmentId } });
      if (!before) throw new NotFoundError("Code not found on this appointment.");
      value = before.codeValue;
      if ("assignedUserId" in raw) await checkProducer(tx, data.assignedUserId);
      const patch: Prisma.AgencyCodeUncheckedUpdateInput = {};
      if ("assignedUserId" in raw) patch.assignedUserId = data.assignedUserId ?? null;
      if ("effectiveTo" in raw) patch.effectiveTo = data.effectiveTo ?? null;
      if (data.status) patch.status = data.status;
      if ("notes" in raw) patch.notes = data.notes ?? null;
      const end = "effectiveTo" in raw ? (data.effectiveTo ?? null) : before.effectiveTo;
      if (end && end < before.effectiveFrom) throw new ValidationError("End date must be on or after the start date.");
      const after = await tx.agencyCode.update({ where: { id: codeId }, data: patch });
      await recordAudit(tx, ctx, { action: "agency_code.update", entityType: "agency_code", entityId: codeId, before, after });
      return after;
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError(overlapMessage(value));
    throw e;
  }
}

// Portal links. Credentials are never stored (DECISIONS D4).

const CREDENTIAL_PATTERNS = [
  /\bpass(word|wd|code|phrase)?\s*[:=]/i,
  /\bpwd\s*[:=]/i,
  /\bpin\s*[:=]/i,
  /\b(user ?name|user ?id|login)\s*[:=]\s*\S+.*\b(pass|pwd)/i,
  /\b(secret|security) (answer|question)\s*[:=]/i,
  /\b(mfa|2fa|otp|totp) (seed|secret|code)\s*[:=]/i,
];

/** Best-effort check that text doesn't contain a password or other secret. Not a guarantee. */
export function looksLikeCredential(text: string | null | undefined): boolean {
  if (!text) return false;
  return CREDENTIAL_PATTERNS.some((re) => re.test(text));
}

const portalSchema = z.object({
  name: requiredText(120),
  url: optionalUrl.refine((u) => !!u, "URL is required"),
  accessInstructions: optionalText(1000),
  credentialVaultReference: optionalText(200),
});

function checkPortal(data: z.infer<typeof portalSchema>) {
  const url = new URL(data.url!);
  if (url.username || url.password) throw new ValidationError("Don't put a username or password in the URL.");
  if (looksLikeCredential(data.accessInstructions) || looksLikeCredential(data.credentialVaultReference)) {
    throw new ValidationError("That looks like a password or other credential. Store logins in the password manager and only note where to find them here.");
  }
}

export async function addPortal(ctx: AuthContext, orgId: string, input: unknown) {
  assertCan(ctx, "appointment.write");
  const data = parse(portalSchema, input);
  checkPortal(data);
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org || org.type === "AGENCY") throw new NotFoundError("Carrier not found.");
    const row = await tx.carrierPortal.create({ data: { organizationId: orgId, name: data.name, url: data.url!, accessInstructions: data.accessInstructions ?? null, credentialVaultReference: data.credentialVaultReference ?? null } });
    await recordAudit(tx, ctx, { action: "portal.create", entityType: "carrier_portal", entityId: row.id, after: row });
    return row;
  });
}

export async function updatePortal(ctx: AuthContext, orgId: string, portalId: string, input: unknown) {
  assertCan(ctx, "appointment.write");
  const data = parse(portalSchema, input);
  checkPortal(data);
  return prisma.$transaction(async (tx) => {
    const before = await tx.carrierPortal.findFirst({ where: { id: portalId, organizationId: orgId } });
    if (!before) throw new NotFoundError("Portal not found on this carrier.");
    const after = await tx.carrierPortal.update({ where: { id: portalId }, data: { name: data.name, url: data.url!, accessInstructions: data.accessInstructions ?? null, credentialVaultReference: data.credentialVaultReference ?? null } });
    await recordAudit(tx, ctx, { action: "portal.update", entityType: "carrier_portal", entityId: portalId, before, after });
    return after;
  });
}

export async function removePortal(ctx: AuthContext, orgId: string, portalId: string) {
  assertCan(ctx, "appointment.write");
  return prisma.$transaction(async (tx) => {
    const row = await tx.carrierPortal.findFirst({ where: { id: portalId, organizationId: orgId } });
    if (!row) throw new NotFoundError("Portal not found on this carrier.");
    await tx.carrierPortal.delete({ where: { id: row.id } });
    await recordAudit(tx, ctx, { action: "portal.remove", entityType: "carrier_portal", entityId: row.id, before: row });
  });
}

/** CSV for the Codes screen. Values are quoted; formula-leading characters are neutralized. */
export function codesCsv(rows: Awaited<ReturnType<typeof listAgencyCodes>>): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ["Carrier", "Product", "Channel", "Agency entity", "Code type", "Code", "Producer", "Status", "Effective from", "Effective to", "Notes"];
  const lines = rows.map((c) =>
    [
      c.appointment.marketChannel.carrierProduct.writingCompany.displayName,
      c.appointment.marketChannel.carrierProduct.product.name,
      c.appointment.marketChannel.intermediary ? `via ${c.appointment.marketChannel.intermediary.displayName}` : "Direct",
      c.appointment.agencyEntity.organization.displayName,
      c.codeType,
      c.codeValue,
      c.assignedUser?.name,
      c.state,
      c.effectiveFrom,
      c.effectiveTo,
      c.notes,
    ].map(cell).join(","),
  );
  return [header.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}
