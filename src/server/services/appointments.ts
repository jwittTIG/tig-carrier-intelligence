import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { ActiveStatus, AgencyCodeType } from "@/generated/prisma/enums";
import { todayUtc } from "@/lib/dates";
import { recordAudit } from "@/server/audit";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { optionalId, optionalText, optionalUrl, parse, requiredText } from "@/server/validation";

/**
 * Agency and producer codes and carrier portal links, kept as a reference (PRD screen 6).
 * TIG's corporate office manages appointments (Josh, 2026-11-06; DECISIONS N19), so this app
 * doesn't track appointment dates, statuses or authorizations. In the database an
 * `agency_appointments` row now only groups the codes for one agency entity and channel.
 * Overlapping ACTIVE duplicate codes are still refused by the database.
 */

type Tx = Prisma.TransactionClient;

const channelInclude = {
  carrierProduct: { include: { writingCompany: { select: { id: true, displayName: true } }, product: { select: { id: true, name: true, line: { select: { name: true } } } } } },
  intermediary: { select: { id: true, displayName: true } },
} satisfies Prisma.MarketChannelInclude;

/** Codes touching a carrier: on its own products' channels or through it as intermediary. */
const groupsForOrg = (orgId: string): Prisma.AgencyAppointmentWhereInput => ({
  marketChannel: { OR: [{ intermediaryOrgId: orgId }, { carrierProduct: { writingCompanyId: orgId } }] },
});

/** A code is in use when it is marked active and hasn't been given an end date in the past. */
export function codeInUse(c: { status: string; effectiveTo: Date | null }, today = todayUtc()): boolean {
  return c.status === "ACTIVE" && (!c.effectiveTo || c.effectiveTo >= today);
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

const codeInclude = {
  assignedUser: { select: { id: true, name: true } },
  appointment: { include: { agencyEntity: { include: { organization: { select: { displayName: true } } } }, marketChannel: { include: channelInclude } } },
} satisfies Prisma.AgencyCodeInclude;

/** Codes for one carrier's channels, in-use first. */
export async function listCodesForCarrier(ctx: AuthContext, orgId: string) {
  assertCan(ctx, "appointment.read");
  const today = todayUtc();
  const rows = await prisma.agencyCode.findMany({
    where: { appointment: groupsForOrg(orgId) },
    orderBy: [{ status: "asc" }, { codeValue: "asc" }],
    include: codeInclude,
  });
  return rows.map((c) => ({ ...c, inUse: codeInUse(c, today) })).sort((a, b) => Number(b.inUse) - Number(a.inUse));
}

const codeListSchema = z.object({
  q: optionalText(80),
  organizationId: optionalId,
  assignedUserId: optionalId,
  state: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["active", "inactive"]).optional()),
});

/** All agency and producer codes, for the API and CSV export. */
export async function listAgencyCodes(ctx: AuthContext, filters: z.input<typeof codeListSchema> = {}) {
  assertCan(ctx, "appointment.read");
  const f = parse(codeListSchema, filters);
  const today = todayUtc();
  const rows = await prisma.agencyCode.findMany({
    where: {
      ...(f.q && { codeValue: { contains: f.q, mode: "insensitive" } }),
      ...(f.assignedUserId && { assignedUserId: f.assignedUserId }),
      ...(f.organizationId && { appointment: groupsForOrg(f.organizationId) }),
    },
    orderBy: [{ appointment: { marketChannel: { carrierProduct: { writingCompany: { displayName: "asc" } } } } }, { codeValue: "asc" }],
    include: codeInclude,
  });
  return rows.map((c) => ({ ...c, inUse: codeInUse(c, today) })).filter((c) => !f.state || (f.state === "active") === c.inUse);
}

export async function listPortals(ctx: AuthContext, orgId: string) {
  assertCan(ctx, "appointment.read");
  return prisma.carrierPortal.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });
}

// ───────────────────────────── Writes ─────────────────────────────

const codeSchema = z.object({
  marketChannelId: z.uuid({ error: "Choose the product and channel the code is for" }),
  agencyEntityId: optionalId,
  codeType: z.enum(AgencyCodeType),
  codeValue: requiredText(60),
  assignedUserId: optionalId,
  notes: optionalText(1000),
});

function isExclusionViolation(e: unknown): boolean {
  const s = JSON.stringify(e, Object.getOwnPropertyNames(e as object)) ?? "";
  return s.includes("23P01") || s.includes("agency_codes_no_overlap_excl") || (e instanceof Error && /exclusion constraint/i.test(e.message));
}

const overlapMessage = (value: string) => `Code ${value} is already active for this channel. Mark the existing one inactive first.`;

async function checkProducer(tx: Tx, userId: string | null | undefined) {
  if (!userId) return;
  const u = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!u || u.status === "DEACTIVATED") throw new ValidationError("Producer must be a current user.");
}

/** The row that groups codes for an agency entity and channel; created the first time. */
async function codeGroup(tx: Tx, ctx: AuthContext, marketChannelId: string, agencyEntityId: string | null | undefined) {
  if (!(await tx.marketChannel.findUnique({ where: { id: marketChannelId } }))) throw new ValidationError("Channel not found.");
  const entities = await tx.agencyEntity.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  const entityId = agencyEntityId ?? (entities.length === 1 ? entities[0].id : null);
  if (!entityId || !entities.some((e) => e.id === entityId)) throw new ValidationError("Choose which agency entity the code belongs to.");
  const existing = await tx.agencyAppointment.findFirst({ where: { marketChannelId, agencyEntityId: entityId }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  const row = await tx.agencyAppointment.create({ data: { marketChannelId, agencyEntityId: entityId, appointmentType: "Agency codes (appointment managed by corporate)", status: "ACTIVE" } });
  await recordAudit(tx, ctx, { action: "agency_code_group.create", entityType: "agency_appointment", entityId: row.id, after: row });
  return row;
}

export async function addAgencyCode(ctx: AuthContext, input: unknown) {
  assertCan(ctx, "appointment.write");
  const data = parse(codeSchema, input);
  try {
    return await prisma.$transaction(async (tx) => {
      const group = await codeGroup(tx, ctx, data.marketChannelId, data.agencyEntityId);
      await checkProducer(tx, data.assignedUserId);
      const row = await tx.agencyCode.create({
        data: { appointmentId: group.id, codeType: data.codeType, codeValue: data.codeValue, assignedUserId: data.assignedUserId ?? null, notes: data.notes ?? null, effectiveFrom: todayUtc(), status: "ACTIVE" },
      });
      await recordAudit(tx, ctx, { action: "agency_code.create", entityType: "agency_code", entityId: row.id, after: row });
      return row;
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError(overlapMessage(data.codeValue));
    throw e;
  }
}

const codeUpdate = z.object({ assignedUserId: optionalId, status: z.enum(ActiveStatus).optional(), notes: optionalText(1000) });

/**
 * Changes who a code is assigned to, whether it's in use, or its notes. The value and type
 * don't change: add a new code instead, so history stays readable.
 */
export async function updateAgencyCode(ctx: AuthContext, codeId: string, input: unknown) {
  assertCan(ctx, "appointment.write");
  const data = parse(codeUpdate, input);
  const raw = (input ?? {}) as Record<string, unknown>;
  let value = "";
  try {
    return await prisma.$transaction(async (tx) => {
      if (!z.uuid().safeParse(codeId).success) throw new NotFoundError("Code not found.");
      const before = await tx.agencyCode.findUnique({ where: { id: codeId } });
      if (!before) throw new NotFoundError("Code not found.");
      value = before.codeValue;
      if ("assignedUserId" in raw) await checkProducer(tx, data.assignedUserId);
      const patch: Prisma.AgencyCodeUncheckedUpdateInput = {};
      if ("assignedUserId" in raw) patch.assignedUserId = data.assignedUserId ?? null;
      if (data.status) patch.status = data.status;
      if ("notes" in raw) patch.notes = data.notes ?? null;
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

/** CSV of codes. Values are quoted; formula-leading characters are neutralized. */
export function codesCsv(rows: Awaited<ReturnType<typeof listAgencyCodes>>): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ["Carrier", "Product", "Channel", "Agency entity", "Code type", "Code", "Producer", "In use", "Notes"];
  const lines = rows.map((c) =>
    [
      c.appointment.marketChannel.carrierProduct.writingCompany.displayName,
      c.appointment.marketChannel.carrierProduct.product.name,
      c.appointment.marketChannel.intermediary ? `via ${c.appointment.marketChannel.intermediary.displayName}` : "Direct",
      c.appointment.agencyEntity.organization.displayName,
      c.codeType,
      c.codeValue,
      c.assignedUser?.name,
      c.inUse ? "Yes" : "No",
      c.notes,
    ].map(cell).join(","),
  );
  return [header.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}

const targetsSchema = z.object({
  /** "ch:<market channel id>", "cp:<carrier product id>" (a line with no channel yet: its direct channel is created), or "all". */
  targets: z.preprocess(
    (v) => (Array.isArray(v) ? v : typeof v === "string" && v !== "" ? [v] : []),
    z.array(z.string().regex(/^((ch|cp):[0-9a-f-]{36}|all)$/, "Pick the lines the code is for")).min(1, "Pick at least one line the code is for"),
  ),
  agencyEntityId: optionalId,
  codeType: z.enum(AgencyCodeType),
  codeValue: requiredText(60),
  assignedUserId: optionalId,
  notes: optionalText(1000),
});

/** The channel a code target points at; a line without one gets its direct channel (no intermediary). */
async function channelFor(tx: Tx, ctx: AuthContext, carrierId: string, target: string): Promise<string> {
  const [kind, id] = target.split(":") as ["ch" | "cp", string];
  if (kind === "ch") {
    const ch = await tx.marketChannel.findFirst({ where: { id, archivedAt: null, OR: [{ intermediaryOrgId: carrierId }, { carrierProduct: { writingCompanyId: carrierId } }] } });
    if (!ch) throw new ValidationError("That channel isn't on this carrier.");
    return ch.id;
  }
  const cp = await tx.carrierProduct.findFirst({ where: { id, writingCompanyId: carrierId, archivedAt: null } });
  if (!cp) throw new ValidationError("That line isn't on this carrier.");
  const direct = await tx.marketChannel.findFirst({ where: { carrierProductId: cp.id, distributionType: "DIRECT", intermediaryOrgId: null, archivedAt: null } });
  if (direct) return direct.id;
  const row = await tx.marketChannel.create({ data: { carrierProductId: cp.id, distributionType: "DIRECT", accessStatus: "AVAILABLE" } });
  await recordAudit(tx, ctx, { action: "carrier.channel.add", entityType: "market_channel", entityId: row.id, after: { ...row, reason: "Created for an agency code (direct)" } });
  return row.id;
}

/**
 * Adds one code for one or more of a carrier's lines (Josh, 2026-11-10: there was nowhere to add
 * a code until a channel existed). Each line gets its own row, so codes can differ by line later.
 */
export async function addAgencyCodes(ctx: AuthContext, carrierId: string, input: unknown) {
  assertCan(ctx, "appointment.write");
  const data = parse(targetsSchema, input);
  // "all": every line of the carrier, as offered on the Codes tab (looked up before the transaction).
  const targets = data.targets.includes("all") ? (await codeTargets(ctx, carrierId)).map((x) => x.value) : data.targets;
  try {
    return await prisma.$transaction(async (tx) => {
      await checkProducer(tx, data.assignedUserId);
      const rows = [];
      for (const target of [...new Set(targets)]) {
        const channelId = await channelFor(tx, ctx, carrierId, target);
        const group = await codeGroup(tx, ctx, channelId, data.agencyEntityId);
        const row = await tx.agencyCode.create({
          data: { appointmentId: group.id, codeType: data.codeType, codeValue: data.codeValue, assignedUserId: data.assignedUserId ?? null, notes: data.notes ?? null, effectiveFrom: todayUtc(), status: "ACTIVE" },
        });
        await recordAudit(tx, ctx, { action: "agency_code.create", entityType: "agency_code", entityId: row.id, after: row });
        rows.push(row);
      }
      return rows;
    }, { timeout: 60_000 }); // a code for every line of a big carrier is many writes
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError(overlapMessage(data.codeValue));
    throw e;
  }
}

/** The lines a code can be added for: each channel, plus each line that has no channel yet. */
export async function codeTargets(ctx: AuthContext, carrierId: string) {
  assertCan(ctx, "carrier.read");
  const [channels, lines] = await Promise.all([
    listChannelsForOrg(ctx, carrierId),
    prisma.carrierProduct.findMany({ where: { writingCompanyId: carrierId, archivedAt: null }, include: { product: { select: { name: true } }, channels: { where: { archivedAt: null }, select: { id: true } } }, orderBy: { product: { name: "asc" } } }),
  ]);
  return [
    ...lines.filter((l) => l.channels.length === 0).map((l) => ({ value: `cp:${l.id}`, label: l.product.name })),
    ...channels.map((ch) => ({ value: `ch:${ch.id}`, label: channelLabel(ch) })),
  ].sort((a, b) => a.label.localeCompare(b.label));
}
