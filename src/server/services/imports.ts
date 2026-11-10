import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ContactRole, OrganizationType } from "@/generated/prisma/enums";
import { normalizeName, parseCsv, similarity, toCsv } from "@/lib/csv";
import { recordAudit } from "@/server/audit";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { SIGNED_URL_TTL_MS, storage } from "@/server/storage";
import { inspectUpload, scanUpload } from "@/server/storage/inspect";
import { parse } from "@/server/validation";
import { numberSetting } from "./settings";
import { CONTACT_ROLES } from "@/lib/contact-roles";

/**
 * CSV import (PRD workflow F, P0-10): upload → map columns → preview → commit in one
 * transaction → error report → audit. Targets: carriers and contacts. Imports never
 * overwrite existing records: exact duplicates are skipped, possible duplicates are skipped
 * unless the user chooses to create them. Every created record gets an IMPORT source.
 * Appetite, codes and commissions imports wait for TIG's sample sheets (DECISIONS D16).
 */

export const MAX_ROWS = 5000;
const SIMILAR = 0.6;

type FieldDef = { key: string; label: string; required?: boolean; aliases: string[] };

export const TARGETS = {
  ORGANIZATION: {
    label: "Carriers",
    fields: [
      { key: "displayName", label: "Display name", required: true, aliases: ["name", "carrier", "carrier name", "company", "display name", "market"] },
      { key: "legalName", label: "Legal name", aliases: ["legal name", "legal", "writing company"] },
      { key: "type", label: "Type", aliases: ["type", "org type", "category"] },
      { key: "status", label: "Status", aliases: ["status", "active"] },
      { key: "website", label: "Website", aliases: ["website", "url", "web"] },
      { key: "portalUrl", label: "Carrier portal site", aliases: ["portal", "portal site", "portal url", "carrier portal", "carrier portal site", "agent portal", "login", "login url"] },
      { key: "naic", label: "NAIC number", aliases: ["naic", "naic #", "naic number", "naic code"] },
      { key: "parentName", label: "Group (existing carrier name)", aliases: ["group", "parent", "parent company"] },
      { key: "ownerEmail", label: "Relationship owner email", aliases: ["owner", "owner email", "relationship owner"] },
    ] as FieldDef[],
  },
  CONTACT: {
    label: "Contacts",
    fields: [
      { key: "firstName", label: "First name", required: true, aliases: ["first", "first name", "firstname"] },
      { key: "lastName", label: "Last name", required: true, aliases: ["last", "last name", "lastname", "surname"] },
      { key: "email", label: "Email", aliases: ["email", "e-mail", "email address"] },
      { key: "officePhone", label: "Office phone", aliases: ["phone", "office", "office phone", "work phone"] },
      { key: "mobilePhone", label: "Mobile phone", aliases: ["mobile", "cell", "mobile phone"] },
      { key: "carrierName", label: "Carrier (existing name)", aliases: ["carrier", "company", "carrier name", "market"] },
      { key: "role", label: "Role", aliases: ["role", "position type"] },
      { key: "title", label: "Title", aliases: ["title", "job title"] },
      { key: "state", label: "Territory (state or US)", aliases: ["state", "territory", "region"] },
    ] as FieldDef[],
  },
} as const;
export type ImportTarget = keyof typeof TARGETS;

const ORG_TYPES: Record<string, OrganizationType> = {
  insurer: "INSURER", carrier: "INSURER", company: "INSURER", "insurance company": "INSURER", "writing company": "INSURER",
  group: "GROUP", mga: "MGA", mgu: "MGU", wholesaler: "WHOLESALER", wholesale: "WHOLESALER", broker: "WHOLESALER",
  "program administrator": "PROGRAM_ADMIN", program: "PROGRAM_ADMIN", "program admin": "PROGRAM_ADMIN",
  "general agency": "GENERAL_AGENCY", ga: "GENERAL_AGENCY", mga_ga: "GENERAL_AGENCY", other: "OTHER",
};
// Every contact type by its label and code (lower case), plus common shorthand.
const ROLES: Record<string, ContactRole> = {
  ...Object.fromEntries(CONTACT_ROLES.flatMap((r) => [[r.label.toLowerCase(), r.code], [r.code.toLowerCase().replace(/_/g, " "), r.code]])),
  underwriter: "UNDERWRITER", uw: "UNDERWRITER", "marketing rep": "MARKETING_REP", marketing: "MARKETING_REP", "territory manager": "MARKETING_REP",
  "pl underwriter": "PL_UNDERWRITER", "personal lines underwriter": "PL_UNDERWRITER", "cl underwriter": "CL_UNDERWRITER", "commercial lines underwriter": "CL_UNDERWRITER",
  "middle market underwriter": "MIDDLE_MARKET_UNDERWRITER", "marine underwriter": "MARINE_UNDERWRITER", "inland marine underwriter": "MARINE_UNDERWRITER",
  "underwriting manager": "UNDERWRITING_MANAGER", adjuster: "CLAIMS_ADJUSTER", "claims adjuster": "CLAIMS_ADJUSTER", "claims manager": "CLAIMS_MANAGER",
  "loss control": "LOSS_CONTROL", "risk engineer": "LOSS_CONTROL", auditor: "PREMIUM_AUDITOR", "premium auditor": "PREMIUM_AUDITOR", billing: "BILLING",
  "regional manager": "REGIONAL_MANAGER", "branch manager": "BRANCH_MANAGER", "product manager": "PRODUCT_MANAGER", service: "SERVICE", claims: "CLAIMS", other: "OTHER",
};

export function suggestMapping(target: ImportTarget, headers: string[]): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[_\s]+/g, " ").trim();
  const out: Record<string, string> = {};
  for (const f of TARGETS[target].fields) {
    const hit = headers.find((h) => [f.key.toLowerCase(), f.label.toLowerCase(), ...f.aliases].includes(norm(h)));
    if (hit && !Object.values(out).includes(hit)) out[f.key] = hit;
  }
  return out;
}

// ───────────────────────────── Upload ─────────────────────────────

async function loadRows(key: string) {
  const text = new TextDecoder("utf-8").decode(await storage().get(key));
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "The CSV couldn't be read.");
  }
  const [header = [], ...data] = rows;
  return { headers: header.map((h) => h.trim()), rows: data };
}

export async function uploadImport(ctx: AuthContext, input: unknown, file: { name: string; bytes: Uint8Array }) {
  assertCan(ctx, "import.run");
  const { targetType } = parse(z.object({ targetType: z.enum(Object.keys(TARGETS) as [ImportTarget, ...ImportTarget[]]) }), input);
  const inspected = await inspectUpload(file.name, file.bytes, (await numberSetting("document.max_upload_mb")) * 1024 * 1024);
  if (!inspected.ok) throw new ValidationError(inspected.reason);
  if (inspected.mimeType !== "text/csv") throw new ValidationError("Upload a .csv file. Excel import waits for DECISIONS D16; for now, save the sheet as CSV (UTF-8).");
  if (!(await scanUpload(file.bytes)).clean) throw new ValidationError("The file failed the malware scan.");
  const key = `imports/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.csv`;
  await storage().put(key, file.bytes, "text/csv");
  const { headers, rows } = await loadRows(key);
  if (headers.length === 0 || rows.length === 0) throw new ValidationError("The file needs a header row and at least one data row.");
  if (rows.length > MAX_ROWS) throw new ValidationError(`The file has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.`);
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) throw new ValidationError("Two columns have the same header. Rename one and upload again.");
  return prisma.$transaction(async (tx) => {
    const job = await tx.importJob.create({
      data: {
        sourceFilename: file.name.slice(0, 200),
        targetType: targetType as Prisma.ImportJobCreateInput["targetType"],
        mapping: { sourceKey: key, headers, columns: suggestMapping(targetType, headers), createPossibleDuplicates: false },
        totalRows: rows.length,
        initiatedById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, { action: "import.upload", entityType: "import_job", entityId: job.id, after: { ...job, sha256: inspected.sha256 } });
    return job;
  });
}

type Mapping = { sourceKey: string; headers: string[]; columns: Record<string, string>; createPossibleDuplicates: boolean };

async function findJob(id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Import not found.");
  const job = await prisma.importJob.findUnique({ where: { id }, include: { initiatedBy: { select: { name: true } } } });
  if (!job) throw new NotFoundError("Import not found.");
  return { ...job, map: job.mapping as unknown as Mapping, target: job.targetType as ImportTarget };
}

export async function listImports(ctx: AuthContext) {
  assertCan(ctx, "import.run");
  return prisma.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { initiatedBy: { select: { name: true } } } });
}

// ───────────────────────────── Preview ─────────────────────────────

export type RowAction = "CREATE" | "DUPLICATE" | "POSSIBLE_DUPLICATE" | "ERROR";
export type PreviewRow = { row: number; action: RowAction; messages: string[]; values: Record<string, string> };

const clean = (v: string | undefined) => (v ?? "").trim();
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function buildPreview(target: ImportTarget, map: Mapping, rows: string[][]): Promise<PreviewRow[]> {
  const idx = Object.fromEntries(Object.entries(map.columns).map(([field, header]) => [field, map.headers.indexOf(header)]));
  const get = (r: string[], field: string) => (idx[field] !== undefined && idx[field] >= 0 ? clean(r[idx[field]]) : "");
  const orgs = await prisma.organization.findMany({ where: { type: { not: "AGENCY" } }, select: { id: true, displayName: true, legalName: true, identifiers: { select: { type: true, value: true } } } });
  const byName = new Map<string, string>();
  for (const o of orgs) for (const n of [o.displayName, o.legalName]) byName.set(normalizeName(n), o.id);
  const out: PreviewRow[] = [];
  const seen = new Map<string, number>();

  if (target === "ORGANIZATION") {
    const naics = new Map(orgs.flatMap((o) => o.identifiers.filter((i) => i.type === "NAIC").map((i) => [i.value, o.displayName] as const)));
    const users = new Map((await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, email: true } })).map((u) => [u.email.toLowerCase(), u.id]));
    rows.forEach((r, i) => {
      const values = Object.fromEntries(TARGETS.ORGANIZATION.fields.map((f) => [f.key, get(r, f.key)]));
      const msgs: string[] = [];
      if (!values.displayName) msgs.push("Display name is missing.");
      if (values.displayName.length > 120) msgs.push("Display name is longer than 120 characters.");
      if (values.type && !ORG_TYPES[values.type.toLowerCase()]) msgs.push(`Unknown type "${values.type}" (use Insurer, Group, MGA, MGU, Wholesaler, Program administrator, General agency or Other).`);
      if (values.website && !/^https?:\/\/\S+$/i.test(values.website)) msgs.push("Website must start with http:// or https://.");
      if (values.portalUrl && !/^https?:\/\/[^/?#@\s]+([/?#]\S*)?$/i.test(values.portalUrl)) msgs.push("Carrier portal site must start with http:// or https:// and must not contain a username or password.");
      if (values.parentName && !byName.has(normalizeName(values.parentName))) msgs.push(`Group "${values.parentName}" isn't in the directory yet. Import groups first.`);
      if (values.ownerEmail && !users.has(values.ownerEmail.toLowerCase())) msgs.push(`Owner ${values.ownerEmail} isn't an active user.`);
      if (values.status && !["active", "prospect", "inactive"].includes(values.status.toLowerCase())) msgs.push(`Unknown status "${values.status}".`);
      if (msgs.length) return out.push({ row: i + 2, action: "ERROR", messages: msgs, values });
      const key = normalizeName(values.displayName);
      if (seen.has(key)) return out.push({ row: i + 2, action: "DUPLICATE", messages: [`Same carrier as row ${seen.get(key)}.`], values });
      seen.set(key, i + 2);
      if (values.naic && naics.has(values.naic)) return out.push({ row: i + 2, action: "DUPLICATE", messages: [`NAIC ${values.naic} is already on ${naics.get(values.naic)}.`], values });
      for (const n of [values.displayName, values.legalName].filter(Boolean)) {
        if (byName.has(normalizeName(n))) return out.push({ row: i + 2, action: "DUPLICATE", messages: [`"${n}" is already in the directory.`], values });
      }
      const near = orgs.find((o) => similarity(o.displayName, values.displayName) >= SIMILAR || similarity(o.legalName, values.legalName || values.displayName) >= SIMILAR);
      if (near) return out.push({ row: i + 2, action: "POSSIBLE_DUPLICATE", messages: [`Looks like "${near.displayName}".`], values });
      out.push({ row: i + 2, action: "CREATE", messages: [], values });
    });
    return out;
  }

  // CONTACT
  const contacts = await prisma.contact.findMany({ where: { archivedAt: null }, select: { firstName: true, lastName: true, email: true, assignments: { select: { organizationId: true } } } });
  const emails = new Set(contacts.map((c) => c.email?.toLowerCase()).filter(Boolean));
  const names = new Map<string, string[]>();
  for (const c of contacts) names.set(`${c.firstName} ${c.lastName}`.toLowerCase(), c.assignments.map((a) => a.organizationId));
  const states = await prisma.territory.findMany({ where: { countryCode: "US", territoryType: { in: ["STATE", "COUNTRY"] } }, select: { stateCode: true, name: true, territoryType: true } });
  const stateOk = (s: string) => ["us", "all", "nationwide", "united states"].includes(s.toLowerCase()) || states.some((t) => t.stateCode?.toLowerCase() === s.toLowerCase() || t.name.toLowerCase() === s.toLowerCase());
  rows.forEach((r, i) => {
    const values = Object.fromEntries(TARGETS.CONTACT.fields.map((f) => [f.key, get(r, f.key)]));
    const msgs: string[] = [];
    if (!values.firstName) msgs.push("First name is missing.");
    if (!values.lastName) msgs.push("Last name is missing.");
    if (values.email && !emailRe.test(values.email)) msgs.push(`"${values.email}" isn't an email address.`);
    const orgId = values.carrierName ? byName.get(normalizeName(values.carrierName)) : undefined;
    if (values.carrierName && !orgId) msgs.push(`Carrier "${values.carrierName}" isn't in the directory. Import or add it first.`);
    if ((values.role || values.state || values.title) && !values.carrierName) msgs.push("Role, title and territory need a carrier.");
    if (values.role && !ROLES[values.role.toLowerCase()]) msgs.push(`Unknown role "${values.role}" (use a contact type such as Marketing rep, PL underwriter, CL underwriter, Claims adjuster or Other).`);
    if (values.state && !stateOk(values.state)) msgs.push(`Unknown territory "${values.state}" (use a state code, a state name, or US).`);
    if (msgs.length) return out.push({ row: i + 2, action: "ERROR", messages: msgs, values });
    const key = values.email ? values.email.toLowerCase() : `${values.firstName} ${values.lastName}|${orgId ?? ""}`.toLowerCase();
    if (seen.has(key)) return out.push({ row: i + 2, action: "DUPLICATE", messages: [`Same person as row ${seen.get(key)}.`], values });
    seen.set(key, i + 2);
    if (values.email && emails.has(values.email.toLowerCase())) return out.push({ row: i + 2, action: "DUPLICATE", messages: [`${values.email} is already a contact.`], values });
    const existing = names.get(`${values.firstName} ${values.lastName}`.toLowerCase());
    if (existing && orgId && existing.includes(orgId)) return out.push({ row: i + 2, action: "DUPLICATE", messages: ["Same name already at this carrier."], values });
    if (existing) return out.push({ row: i + 2, action: "POSSIBLE_DUPLICATE", messages: ["A contact with the same name exists."], values });
    out.push({ row: i + 2, action: "CREATE", messages: [], values });
  });
  return out;
}

const mappingSchema = (target: ImportTarget) =>
  z.object({
    columns: z.record(z.string(), z.string()).transform((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v))),
    createPossibleDuplicates: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).default(false),
  }).superRefine((m, c) => {
    for (const f of TARGETS[target].fields) if (f.required && !m.columns[f.key]) c.addIssue({ code: "custom", message: `Choose a column for ${f.label}`, path: ["columns", f.key] });
    const used = Object.values(m.columns);
    if (new Set(used).size !== used.length) c.addIssue({ code: "custom", message: "A column is mapped to two fields", path: ["columns"] });
  });

export async function getImport(ctx: AuthContext, id: string) {
  assertCan(ctx, "import.run");
  const job = await findJob(id);
  const { headers, rows } = await loadRows(job.map.sourceKey);
  const preview = job.status === "COMMITTED" || job.status === "UNDONE" ? null : await buildPreview(job.target, job.map, rows);
  return { job, headers, sample: rows.slice(0, 5), preview, fields: TARGETS[job.target].fields };
}

export async function saveMapping(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "import.run");
  const job = await findJob(id);
  if (job.status === "COMMITTED") throw new ConflictError("This import has already been committed.");
  const m = parse(mappingSchema(job.target), input);
  for (const h of Object.values(m.columns)) if (!job.map.headers.includes(h)) throw new ValidationError(`Column "${h}" isn't in the file.`);
  const { rows } = await loadRows(job.map.sourceKey);
  const map = { ...job.map, columns: m.columns, createPossibleDuplicates: m.createPossibleDuplicates };
  const preview = await buildPreview(job.target, map, rows);
  const accepted = preview.filter((p) => p.action === "CREATE" || (p.action === "POSSIBLE_DUPLICATE" && map.createPossibleDuplicates)).length;
  return prisma.$transaction(async (tx) => {
    const after = await tx.importJob.update({ where: { id }, data: { mapping: map, status: "PREVIEWED", acceptedRows: accepted, rejectedRows: preview.length - accepted } });
    await recordAudit(tx, ctx, { action: "import.preview", entityType: "import_job", entityId: id, before: { mapping: job.mapping, status: job.status }, after: { mapping: map, status: after.status, accepted } });
    return { job: after, preview };
  });
}

// ───────────────────────────── Commit ─────────────────────────────

const stateFor = async (tx: Prisma.TransactionClient, s: string) => {
  if (!s) return null;
  if (["us", "all", "nationwide", "united states"].includes(s.toLowerCase())) return (await tx.territory.findFirst({ where: { territoryType: "COUNTRY", countryCode: "US" } }))?.id ?? null;
  return (await tx.territory.findFirst({ where: { territoryType: "STATE", OR: [{ stateCode: s.toUpperCase() }, { name: { equals: s, mode: "insensitive" } }] } }))?.id ?? null;
};

/** Creates every accepted row in one transaction (all or nothing), then stores an error report. */
export async function commitImport(ctx: AuthContext, id: string) {
  assertCan(ctx, "import.run");
  const job = await findJob(id);
  if (job.status !== "PREVIEWED") throw new ConflictError(job.status === "COMMITTED" ? "This import has already been committed." : "Preview the import before committing.");
  const { rows } = await loadRows(job.map.sourceKey);
  const preview = await buildPreview(job.target, job.map, rows);
  const take = preview.filter((p) => p.action === "CREATE" || (p.action === "POSSIBLE_DUPLICATE" && job.map.createPossibleDuplicates));
  const rejected = preview.filter((p) => !take.includes(p));
  const created = await runCommit(ctx, job, id, take).catch(async (e) => {
    // Nothing was written (the transaction rolled back); record the failure.
    await prisma.$transaction(async (tx) => {
      await tx.importJob.update({ where: { id }, data: { status: "FAILED" } });
      await recordAudit(tx, ctx, { action: "import.failed", entityType: "import_job", entityId: id, after: { error: e instanceof Error ? e.message.slice(0, 500) : "unknown" } });
    });
    throw e;
  });
  const headers = TARGETS[job.target].fields.map((f) => f.key);
  const report = toCsv([["row", "result", "reason", ...headers], ...rejected.map((p) => [p.row, p.action, p.messages.join(" "), ...headers.map((h) => p.values[h])])]);
  const errorKey = rejected.length ? `imports/${new Date().toISOString().slice(0, 7)}/${randomUUID()}-errors.csv` : null;
  if (errorKey) await storage().put(errorKey, new TextEncoder().encode(report), "text/csv");
  return prisma.$transaction(async (tx) => {
    const after = await tx.importJob.update({ where: { id }, data: { status: "COMMITTED", acceptedRows: created, rejectedRows: rejected.length, errorObjectKey: errorKey } });
    await recordAudit(tx, ctx, { action: "import.commit", entityType: "import_job", entityId: id, after: { status: after.status, created, rejected: rejected.length } });
    return after;
  });
}

async function runCommit(ctx: AuthContext, job: Awaited<ReturnType<typeof findJob>>, id: string, take: PreviewRow[]) {
  return prisma.$transaction(
    async (tx) => {
      const nameToId = new Map((await tx.organization.findMany({ where: { type: { not: "AGENCY" } }, select: { id: true, displayName: true, legalName: true } })).flatMap((o) => [[normalizeName(o.displayName), o.id], [normalizeName(o.legalName), o.id]] as const));
      const userByEmail = new Map((await tx.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, email: true } })).map((u) => [u.email.toLowerCase(), u.id]));
      let count = 0;
      for (const p of take) {
        const v = p.values;
        if (job.target === "ORGANIZATION") {
          const org = await tx.organization.create({
            data: {
              displayName: v.displayName,
              legalName: v.legalName || v.displayName,
              type: v.type ? ORG_TYPES[v.type.toLowerCase()] : "INSURER",
              status: (v.status?.toUpperCase() as "ACTIVE" | "PROSPECT" | "INACTIVE") || "ACTIVE",
              website: v.website || null,
              portalUrl: v.portalUrl || null,
              parentId: v.parentName ? nameToId.get(normalizeName(v.parentName)) ?? null : null,
              ownerUserId: v.ownerEmail ? userByEmail.get(v.ownerEmail.toLowerCase()) ?? null : null,
            },
          });
          if (v.naic) await tx.organizationIdentifier.create({ data: { organizationId: org.id, type: "NAIC", value: v.naic } });
          await tx.recordSource.create({ data: { recordType: "ORGANIZATION", recordId: org.id, sourceKind: "IMPORT", importJobId: id, pageOrSection: `row ${p.row}`, createdById: ctx.userId } });
          await recordAudit(tx, ctx, { action: "import.create", entityType: "organization", entityId: org.id, after: { ...org, importJobId: id, row: p.row } });
        } else {
          const contact = await tx.contact.create({ data: { firstName: v.firstName, lastName: v.lastName, email: v.email ? v.email.toLowerCase() : null, officePhone: v.officePhone || null, mobilePhone: v.mobilePhone || null } });
          const orgId = v.carrierName ? nameToId.get(normalizeName(v.carrierName)) : undefined;
          if (orgId) {
            await tx.contactAssignment.create({ data: { contactId: contact.id, organizationId: orgId, role: v.role ? ROLES[v.role.toLowerCase()] : "UNDERWRITER", title: v.title || null, territoryId: await stateFor(tx, v.state) } });
          }
          await tx.recordSource.create({ data: { recordType: "CONTACT", recordId: contact.id, sourceKind: "IMPORT", importJobId: id, pageOrSection: `row ${p.row}`, createdById: ctx.userId } });
          await recordAudit(tx, ctx, { action: "import.create", entityType: "contact", entityId: contact.id, after: { ...contact, importJobId: id, row: p.row } });
        }
        count++;
      }
      return count;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

export async function errorReportUrl(ctx: AuthContext, id: string) {
  assertCan(ctx, "import.run");
  const job = await findJob(id);
  if (!job.errorObjectKey) throw new NotFoundError("This import has no error report.");
  return storage().signedUrl(job.errorObjectKey, { expiresAt: new Date(Date.now() + SIGNED_URL_TTL_MS), filename: `import-${id.slice(0, 8)}-errors.csv`, contentType: "text/csv" });
}
