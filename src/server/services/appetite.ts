import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AppetiteOutcome, AttributeDataType, IndustryCodeSystem, RuleOperator } from "@/generated/prisma/enums";
import { addDays, freshness, rangesOverlap } from "@/lib/dates";
import { recordAudit } from "@/server/audit";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { optionalDate, optionalId, optionalText, parse, requiredText } from "@/server/validation";
import { closeChangeRequest, openChangeRequest, pendingRequestFor } from "./approvals-core";
import { numberSetting, SETTING } from "./settings";
import { hasSource } from "./sources";

/**
 * Appetite profiles and rules (PRD screen 3 "Appetite", P0-05). Profiles are versioned per
 * carrier product (+ optional channel). Only DRAFT profiles can be edited. Submitting opens a
 * change request; approval (D14) needs an owner, an effective date, at least one rule and at
 * least one source. Approving retires the previous approved version, which stays readable.
 *
 * Rule scope: a rule with no territories applies in every territory, and one with no
 * industries applies to every industry. UNKNOWN is never eligible.
 */

type Tx = Prisma.TransactionClient;

const ruleInclude = {
  territories: { include: { territory: { select: { id: true, name: true, stateCode: true } } } },
  industries: true,
  attributeDefinition: true,
} satisfies Prisma.AppetiteRuleInclude;
type RuleWithScope = Prisma.AppetiteRuleGetPayload<{ include: typeof ruleInclude }>;

async function findProfile(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Appetite profile not found.");
  const p = await tx.appetiteProfile.findUnique({ where: { id } });
  if (!p) throw new NotFoundError("Appetite profile not found.");
  return p;
}

async function findDraft(tx: Tx, id: string) {
  const p = await findProfile(tx, id);
  if (p.status !== "DRAFT") throw new ConflictError("Only draft profiles can be changed. Start a new version to change an approved profile.");
  return p;
}

// ───────────────────────────── Conflicts ─────────────────────────────

export type RuleConflict = { a: string; b: string; reason: string };

/**
 * Rules that could apply to the same risk but give different outcomes: same attribute (or
 * both none), overlapping territories and industries, overlapping dates.
 */
export function findConflicts(rules: RuleWithScope[]): RuleConflict[] {
  const out: RuleConflict[] = [];
  const terr = (r: RuleWithScope) => new Set(r.territories.map((t) => t.territoryId));
  const ind = (r: RuleWithScope) => new Set(r.industries.map((i) => `${i.classificationSystem}:${i.code}`));
  const meets = (x: Set<string>, y: Set<string>) => x.size === 0 || y.size === 0 || [...x].some((v) => y.has(v));
  const far = new Date("9999-12-31");
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      if (a.outcome === b.outcome) continue;
      if ((a.attributeDefinitionId ?? null) !== (b.attributeDefinitionId ?? null)) continue;
      if (!meets(terr(a), terr(b)) || !meets(ind(a), ind(b))) continue;
      if (!rangesOverlap(a.effectiveFrom ?? new Date(0), a.effectiveTo ?? far, b.effectiveFrom ?? new Date(0), b.effectiveTo ?? far)) continue;
      out.push({ a: a.id, b: b.id, reason: `${a.outcome} and ${b.outcome} can apply to the same risk${a.attributeDefinition ? ` (${a.attributeDefinition.label})` : ""}` });
    }
  }
  return out;
}

// ───────────────────────────── Reads ─────────────────────────────

/** Profiles on a carrier's products, or on channels where it is the intermediary. */
export async function listProfilesForCarrier(ctx: AuthContext, orgId: string) {
  assertCan(ctx, "appetite.read");
  const rows = await prisma.appetiteProfile.findMany({
    where: { OR: [{ carrierProduct: { writingCompanyId: orgId } }, { marketChannel: { intermediaryOrgId: orgId } }] },
    orderBy: [{ carrierProductId: "asc" }, { marketChannelId: "asc" }, { version: "desc" }],
    include: {
      carrierProduct: { include: { product: { include: { line: true } }, writingCompany: { select: { id: true, displayName: true } } } },
      marketChannel: { include: { intermediary: { select: { displayName: true } } } },
      _count: { select: { rules: true } },
    },
  });
  return rows.map((p) => ({ ...p, stale: p.status === "APPROVED" && !!p.nextReviewAt && p.nextReviewAt <= new Date() }));
}

export async function getProfile(ctx: AuthContext, id: string) {
  assertCan(ctx, "appetite.read");
  await findProfile(prisma, id);
  const profile = await prisma.appetiteProfile.findUniqueOrThrow({
    where: { id },
    include: {
      carrierProduct: {
        include: {
          product: { include: { line: true, attributeDefinitions: { orderBy: { label: "asc" } } } },
          writingCompany: { select: { id: true, displayName: true } },
          coverages: { orderBy: { coverageCode: "asc" } },
          requirements: { orderBy: { createdAt: "asc" }, include: { sourceDocumentVersion: { select: { id: true, versionNumber: true, document: { select: { title: true } } } } } },
        },
      },
      marketChannel: { include: { intermediary: { select: { id: true, displayName: true } } } },
      owner: { select: { id: true, name: true } },
      approvedBy: { select: { name: true } },
      rules: { orderBy: [{ priority: "asc" }, { createdAt: "asc" }], include: ruleInclude },
    },
  });
  const versions = await prisma.appetiteProfile.findMany({
    where: { carrierProductId: profile.carrierProductId, marketChannelId: profile.marketChannelId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, effectiveFrom: true, effectiveTo: true, approvedAt: true },
  });
  const pending = await pendingRequestFor(prisma, "APPETITE_PROFILE", id);
  const verifications = await prisma.verificationEvent.findMany({ where: { recordType: "APPETITE_PROFILE", recordId: id }, orderBy: { verifiedAt: "desc" }, include: { verifiedBy: { select: { name: true } } } });
  const cadence = await numberSetting(SETTING.appetiteReviewDays);
  return {
    ...profile,
    versions,
    pending,
    verifications,
    conflicts: findConflicts(profile.rules),
    freshness: profile.status === "APPROVED" ? freshness(profile.verifiedAt, cadence) : null,
  };
}

// ───────────────────────────── Profile writes ─────────────────────────────

const createSchema = z.object({ carrierProductId: z.uuid(), marketChannelId: optionalId, effectiveFrom: optionalDate, ownerUserId: optionalId });

async function nextVersion(tx: Tx, carrierProductId: string, marketChannelId: string | null) {
  // Lock the carrier product row so two drafts can't take the same version number.
  await tx.$queryRaw`select id from carrier_products where id = ${carrierProductId}::uuid for update`;
  const last = await tx.appetiteProfile.findFirst({ where: { carrierProductId, marketChannelId }, orderBy: { version: "desc" }, select: { version: true } });
  return (last?.version ?? 0) + 1;
}

export async function createProfile(ctx: AuthContext, input: unknown) {
  assertCan(ctx, "appetite.write");
  const data = parse(createSchema, input);
  return prisma.$transaction(async (tx) => {
    const cp = await tx.carrierProduct.findUnique({ where: { id: data.carrierProductId } });
    if (!cp) throw new ValidationError("Carrier product not found.");
    if (data.marketChannelId) {
      const ch = await tx.marketChannel.findFirst({ where: { id: data.marketChannelId, carrierProductId: cp.id } });
      if (!ch) throw new ValidationError("That channel isn't on this product.");
    }
    const open = await tx.appetiteProfile.findFirst({ where: { carrierProductId: cp.id, marketChannelId: data.marketChannelId ?? null, status: { in: ["DRAFT", "PENDING"] } } });
    if (open) throw new ConflictError(`There is already a ${open.status.toLowerCase()} version (v${open.version}) for this product. Finish or delete it first.`);
    const version = await nextVersion(tx, cp.id, data.marketChannelId ?? null);
    const row = await tx.appetiteProfile.create({
      data: { carrierProductId: cp.id, marketChannelId: data.marketChannelId ?? null, version, status: "DRAFT", effectiveFrom: data.effectiveFrom ?? null, ownerUserId: data.ownerUserId ?? ctx.userId },
    });
    await recordAudit(tx, ctx, { action: "appetite.profile.create", entityType: "appetite_profile", entityId: row.id, after: row });
    return row;
  });
}

const updateSchema = z.object({ effectiveFrom: optionalDate, effectiveTo: optionalDate, ownerUserId: optionalId });

export async function updateProfile(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  const data = parse(updateSchema, input);
  const raw = (input ?? {}) as Record<string, unknown>;
  return prisma.$transaction(async (tx) => {
    const before = await findDraft(tx, id);
    const patch: Prisma.AppetiteProfileUncheckedUpdateInput = {};
    if ("effectiveFrom" in raw) patch.effectiveFrom = data.effectiveFrom ?? null;
    if ("effectiveTo" in raw) patch.effectiveTo = data.effectiveTo ?? null;
    if ("ownerUserId" in raw) {
      if (data.ownerUserId) {
        const u = await tx.user.findUnique({ where: { id: data.ownerUserId } });
        if (!u || u.status !== "ACTIVE") throw new ValidationError("Owner must be an active user.");
      }
      patch.ownerUserId = data.ownerUserId ?? null;
    }
    const from = "effectiveFrom" in raw ? data.effectiveFrom : before.effectiveFrom;
    const to = "effectiveTo" in raw ? data.effectiveTo : before.effectiveTo;
    if (from && to && to < from) throw new ValidationError("End date must be on or after the start date.");
    const after = await tx.appetiteProfile.update({ where: { id }, data: patch });
    await recordAudit(tx, ctx, { action: "appetite.profile.update", entityType: "appetite_profile", entityId: id, before, after });
    return after;
  });
}

/** Deletes a DRAFT that was never submitted. Approved and retired versions are never deleted. */
export async function deleteDraft(ctx: AuthContext, id: string) {
  assertCan(ctx, "appetite.write");
  return prisma.$transaction(async (tx) => {
    const before = await findDraft(tx, id);
    if (await tx.changeRequest.count({ where: { recordType: "APPETITE_PROFILE", recordId: id } })) throw new ConflictError("This draft has review history, so it can't be deleted.");
    const rules = await tx.appetiteRule.findMany({ where: { profileId: id }, select: { id: true } });
    await tx.appetiteRule.deleteMany({ where: { profileId: id } }); // territories/industries cascade
    await tx.appetiteProfile.delete({ where: { id } });
    await recordAudit(tx, ctx, { action: "appetite.profile.delete_draft", entityType: "appetite_profile", entityId: id, before: { ...before, ruleIds: rules.map((r) => r.id) } });
  });
}

type RuleWithLinks = Prisma.AppetiteRuleGetPayload<{ include: { territories: true; industries: true } }>;

/** Copies rules (with their states and industries) onto another profile. Returns the new rule ids. */
export async function copyRules(tx: Tx, rules: RuleWithLinks[], toProfileId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const r of rules) {
    const row = await tx.appetiteRule.create({
      data: {
        profileId: toProfileId,
        attributeDefinitionId: r.attributeDefinitionId,
        operator: r.operator,
        typedValue: r.typedValue ?? Prisma.DbNull,
        outcome: r.outcome,
        priority: r.priority,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        rationale: r.rationale,
        territories: { create: r.territories.map((t) => ({ territoryId: t.territoryId })) },
        industries: { create: r.industries.map((i) => ({ classificationSystem: i.classificationSystem, code: i.code })) },
      },
    });
    ids.push(row.id);
  }
  return ids;
}

/** Copies an approved or retired version into a new DRAFT (sources must be cited again). */
export async function newVersion(ctx: AuthContext, id: string) {
  assertCan(ctx, "appetite.write");
  return prisma.$transaction(async (tx) => {
    const src = await tx.appetiteProfile.findUnique({ where: { id }, include: { rules: { include: { territories: true, industries: true } } } });
    if (!src) throw new NotFoundError("Appetite profile not found.");
    if (src.status === "DRAFT" || src.status === "PENDING") throw new ConflictError("This version isn't approved yet.");
    const open = await tx.appetiteProfile.findFirst({ where: { carrierProductId: src.carrierProductId, marketChannelId: src.marketChannelId, status: { in: ["DRAFT", "PENDING"] } } });
    if (open) throw new ConflictError(`Version ${open.version} is already in progress.`);
    const version = await nextVersion(tx, src.carrierProductId, src.marketChannelId);
    const copy = await tx.appetiteProfile.create({
      data: { carrierProductId: src.carrierProductId, marketChannelId: src.marketChannelId, version, status: "DRAFT", ownerUserId: src.ownerUserId ?? ctx.userId },
    });
    await copyRules(tx, src.rules, copy.id);
    await recordAudit(tx, ctx, { action: "appetite.profile.new_version", entityType: "appetite_profile", entityId: copy.id, after: { ...copy, copiedFrom: src.id, rules: src.rules.length } });
    return copy;
  });
}

// ───────────────────────────── Rules ─────────────────────────────

const decimal = /^-?\d+(\.\d+)?$/;

function typedValueFor(dataType: AttributeDataType, operator: RuleOperator, raw: string | undefined): Prisma.InputJsonValue | undefined {
  if (operator === "EXISTS") return undefined;
  const v = (raw ?? "").trim();
  if (!v) throw new ValidationError("Enter a value for this rule.");
  const numeric = dataType === "NUMBER" || dataType === "MONEY" || dataType === "INTEGER";
  const check = (s: string) => {
    const clean = s.replace(/[$,\s]/g, "");
    if (numeric && !decimal.test(clean)) throw new ValidationError(`"${s}" isn't a number.`);
    if (dataType === "INTEGER" && clean.includes(".")) throw new ValidationError(`"${s}" isn't a whole number.`);
    if (dataType === "DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`"${s}" isn't a date (YYYY-MM-DD).`);
    if (dataType === "BOOLEAN" && !["true", "false", "yes", "no"].includes(s.toLowerCase())) throw new ValidationError(`"${s}" isn't yes or no.`);
    return numeric ? clean : dataType === "BOOLEAN" ? String(["true", "yes"].includes(s.toLowerCase())) : s;
  };
  if (operator === "BETWEEN") {
    const [min, max] = v.split(/\s*(?:\.\.|–|-(?=\s)|to)\s*/i);
    if (!min || !max) throw new ValidationError('Enter a range as "min to max".');
    const lo = check(min);
    const hi = check(max);
    if (numeric && Number(lo) > Number(hi)) throw new ValidationError("The minimum is larger than the maximum.");
    return { min: lo, max: hi };
  }
  if (operator === "IN" || operator === "NOT_IN") return { values: v.split(",").map((s) => check(s.trim())).filter(Boolean) };
  return { value: check(v) };
}

const ruleSchema = z
  .object({
    outcome: z.enum(AppetiteOutcome),
    territoryIds: z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []), z.array(z.uuid()).max(60)),
    industries: optionalText(500),
    attributeDefinitionId: optionalId,
    operator: z.preprocess((v) => (v === "" ? undefined : v), z.enum(RuleOperator).optional()),
    value: optionalText(500),
    priority: z.coerce.number().int().min(0).max(10000).default(100),
    effectiveFrom: optionalDate,
    effectiveTo: optionalDate,
    rationale: optionalText(2000),
  })
  .refine((r) => !r.effectiveFrom || !r.effectiveTo || r.effectiveTo >= r.effectiveFrom, { message: "End date must be on or after the start date", path: ["effectiveTo"] })
  .refine((r) => !r.attributeDefinitionId || !!r.operator, { message: "Choose how to compare the attribute", path: ["operator"] });

/** "NAICS 238160, ISO_GL 91111" → [{system, code}] */
export function parseIndustries(text: string | undefined): { classificationSystem: IndustryCodeSystem; code: string }[] {
  if (!text) return [];
  const systems = Object.values(IndustryCodeSystem) as string[];
  return text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).map((part) => {
    const m = part.match(/^([A-Za-z_]+)[\s:]+(\S+)$/);
    const sys = m?.[1].toUpperCase().replace(/^ISO$/, "ISO_GL");
    if (!m || !sys || !systems.includes(sys)) throw new ValidationError(`"${part}": write each industry as SYSTEM CODE, e.g. NAICS 238160 (systems: ${systems.join(", ")}).`);
    return { classificationSystem: sys as IndustryCodeSystem, code: m[2].toUpperCase() };
  });
}

export async function addRule(ctx: AuthContext, profileId: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  const data = parse(ruleSchema, input);
  const industries = [...new Map(parseIndustries(data.industries).map((i) => [`${i.classificationSystem}:${i.code}`, i])).values()];
  return prisma.$transaction(async (tx) => {
    const profile = await findDraft(tx, profileId);
    let typedValue: Prisma.InputJsonValue | undefined;
    if (data.attributeDefinitionId) {
      const def = await tx.riskAttributeDefinition.findUnique({ where: { id: data.attributeDefinitionId }, include: { product: { include: { carrierProducts: { where: { id: profile.carrierProductId } } } } } });
      if (!def || def.product.carrierProducts.length === 0) throw new ValidationError("That attribute isn't defined for this product.");
      typedValue = typedValueFor(def.dataType, data.operator!, data.value);
      // A list's rule values must be among its allowed values.
      const allowed = allowedValuesOf(def.validationSchema);
      if (allowed && typedValue) {
        const t = typedValue as { value?: string; values?: string[] };
        const bad = [...(t.values ?? []), ...(t.value !== undefined ? [t.value] : [])].filter((x) => !allowed.some((a) => a.toLowerCase() === x.toLowerCase()));
        if (bad.length) throw new ValidationError(`"${bad.join(", ")}" isn't one of the allowed values for ${def.label} (${allowed.join(", ")}).`);
      }
    }
    if (data.territoryIds.length) {
      const n = await tx.territory.count({ where: { id: { in: data.territoryIds } } });
      if (n !== new Set(data.territoryIds).size) throw new ValidationError("Unknown territory.");
    }
    const rule = await tx.appetiteRule.create({
      data: {
        profileId,
        outcome: data.outcome,
        attributeDefinitionId: data.attributeDefinitionId ?? null,
        operator: data.attributeDefinitionId ? data.operator! : null,
        typedValue: typedValue ?? Prisma.DbNull,
        priority: data.priority,
        effectiveFrom: data.effectiveFrom ?? null,
        effectiveTo: data.effectiveTo ?? null,
        rationale: data.rationale ?? null,
        territories: { create: [...new Set(data.territoryIds)].map((territoryId) => ({ territoryId })) },
        industries: { create: industries },
      },
      include: { territories: true, industries: true },
    });
    await recordAudit(tx, ctx, { action: "appetite.rule.add", entityType: "appetite_rule", entityId: rule.id, after: { ...rule, profileId } });
    return rule;
  });
}

export async function removeRule(ctx: AuthContext, profileId: string, ruleId: string) {
  assertCan(ctx, "appetite.write");
  return prisma.$transaction(async (tx) => {
    await findDraft(tx, profileId);
    const rule = await tx.appetiteRule.findFirst({ where: { id: ruleId, profileId }, include: { territories: true, industries: true } });
    if (!rule) throw new NotFoundError("Rule not found on this profile.");
    await tx.appetiteRule.delete({ where: { id: ruleId } });
    await recordAudit(tx, ctx, { action: "appetite.rule.remove", entityType: "appetite_rule", entityId: ruleId, before: { ...rule, profileId } });
  });
}

const attributeSchema = z
  .object({
    key: z.string().trim().toLowerCase().pipe(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Use lowercase letters, digits and _")),
    label: requiredText(80),
    dataType: z.enum(AttributeDataType),
    unit: optionalText(20),
    /** For ENUM: the allowed values, as a list or comma-separated text. */
    allowedValues: z
      .preprocess((v) => (typeof v === "string" ? v.split(",") : (v ?? [])), z.array(z.string().trim().max(80)))
      .transform((vs) => [...new Set(vs.filter(Boolean))])
      .optional(),
  })
  .refine((a) => !a.allowedValues?.length || a.dataType === "ENUM", { message: "Only a list (ENUM) can have allowed values", path: ["allowedValues"] })
  .refine((a) => (a.allowedValues?.length ?? 0) <= 100, { message: "At most 100 allowed values", path: ["allowedValues"] });

/** Allowed values of an ENUM risk detail ({ values: [...] } in validation_schema), or null. */
export function allowedValuesOf(validationSchema: unknown): string[] | null {
  const v = (validationSchema as { values?: unknown } | null)?.values;
  return Array.isArray(v) && v.length && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

export async function addAttributeDefinition(ctx: AuthContext, productId: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  const data = parse(attributeSchema, input);
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await tx.insuranceProduct.findUnique({ where: { id: productId } }))) throw new NotFoundError("Product not found.");
      const row = await tx.riskAttributeDefinition.create({
        data: { productId, key: data.key, label: data.label, dataType: data.dataType, unit: data.unit ?? null, ...(data.allowedValues?.length && { validationSchema: { values: data.allowedValues } }) },
      });
      await recordAudit(tx, ctx, { action: "appetite.attribute.add", entityType: "risk_attribute_definition", entityId: row.id, after: row });
      return row;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictError(`The attribute "${data.key}" already exists for this product.`);
    throw e;
  }
}

// ───────────────────── Coverages & requirements (per carrier product) ─────────────────────

const money = (label: string) =>
  z.preprocess((v) => (typeof v === "string" ? v.replace(/[$,\s]/g, "") : v), z.union([z.literal(""), z.string().regex(decimal, `${label} must be a number`)]).optional())
    .transform((v) => (v ? new Prisma.Decimal(v) : null));

const coverageSchema = z
  .object({ coverageCode: requiredText(60), minLimit: money("Minimum limit"), maxLimit: money("Maximum limit") })
  .refine((c) => !c.minLimit || !c.maxLimit || c.maxLimit.gte(c.minLimit), { message: "Maximum must be at least the minimum", path: ["maxLimit"] });

export async function addCoverage(ctx: AuthContext, carrierProductId: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  const data = parse(coverageSchema, input);
  return prisma.$transaction(async (tx) => {
    if (!(await tx.carrierProduct.findUnique({ where: { id: carrierProductId } }))) throw new NotFoundError("Carrier product not found.");
    const row = await tx.coverageCapability.create({ data: { carrierProductId, coverageCode: data.coverageCode, minLimit: data.minLimit, maxLimit: data.maxLimit } });
    await recordAudit(tx, ctx, { action: "appetite.coverage.add", entityType: "coverage_capability", entityId: row.id, after: row });
    return row;
  });
}

export async function removeCoverage(ctx: AuthContext, carrierProductId: string, coverageId: string) {
  assertCan(ctx, "appetite.write");
  return prisma.$transaction(async (tx) => {
    const row = await tx.coverageCapability.findFirst({ where: { id: coverageId, carrierProductId } });
    if (!row) throw new NotFoundError("Coverage not found on this product.");
    await tx.coverageCapability.delete({ where: { id: row.id } });
    await recordAudit(tx, ctx, { action: "appetite.coverage.remove", entityType: "coverage_capability", entityId: row.id, before: row });
  });
}

const requirementSchema = z.object({ requirementType: requiredText(80), description: requiredText(2000), sourceDocumentVersionId: optionalId });

export async function addRequirement(ctx: AuthContext, carrierProductId: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  const data = parse(requirementSchema, input);
  return prisma.$transaction(async (tx) => {
    if (!(await tx.carrierProduct.findUnique({ where: { id: carrierProductId } }))) throw new NotFoundError("Carrier product not found.");
    if (data.sourceDocumentVersionId && !(await tx.documentVersion.findUnique({ where: { id: data.sourceDocumentVersionId } }))) throw new ValidationError("Document not found.");
    const row = await tx.underwritingRequirement.create({ data: { carrierProductId, requirementType: data.requirementType, description: data.description, sourceDocumentVersionId: data.sourceDocumentVersionId ?? null } });
    await recordAudit(tx, ctx, { action: "appetite.requirement.add", entityType: "underwriting_requirement", entityId: row.id, after: row });
    return row;
  });
}

export async function removeRequirement(ctx: AuthContext, carrierProductId: string, requirementId: string) {
  assertCan(ctx, "appetite.write");
  return prisma.$transaction(async (tx) => {
    const row = await tx.underwritingRequirement.findFirst({ where: { id: requirementId, carrierProductId } });
    if (!row) throw new NotFoundError("Requirement not found on this product.");
    await tx.underwritingRequirement.delete({ where: { id: row.id } });
    await recordAudit(tx, ctx, { action: "appetite.requirement.remove", entityType: "underwriting_requirement", entityId: row.id, before: row });
  });
}

// ───────────────────────────── Approval ─────────────────────────────

/** Draft → PENDING, with a change request that carries the comparison to the current approved version. */
export async function submitProfile(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  const { note } = parse(z.object({ note: optionalText(1000) }), input);
  return prisma.$transaction(async (tx) => {
    const p = await findDraft(tx, id);
    const problems: string[] = [];
    if (!p.ownerUserId) problems.push("an owner");
    if (!p.effectiveFrom) problems.push("an effective date");
    if ((await tx.appetiteRule.count({ where: { profileId: id } })) === 0) problems.push("at least one rule");
    if (!(await hasSource(tx, "APPETITE_PROFILE", id))) problems.push("a source (a document page or a note of where this came from)");
    if (problems.length) throw new ValidationError(`Before submitting, add ${problems.join(", ")}.`);
    const current = await tx.appetiteProfile.findFirst({ where: { carrierProductId: p.carrierProductId, marketChannelId: p.marketChannelId, status: "APPROVED" }, orderBy: { version: "desc" } });
    const after = await tx.appetiteProfile.update({ where: { id }, data: { status: "PENDING" } });
    await openChangeRequest(tx, ctx, { recordType: "APPETITE_PROFILE", recordId: id, proposed: { action: "approve", version: p.version, replaces: current ? { id: current.id, version: current.version } : null }, note });
    await recordAudit(tx, ctx, { action: "appetite.profile.submit", entityType: "appetite_profile", entityId: id, before: p, after });
    return after;
  });
}

/** Applied by approvals.decide(). Retires the previous approved version. */
export async function applyProfileDecision(tx: Tx, ctx: AuthContext, id: string, decision: "APPROVE" | "REJECT") {
  const p = await findProfile(tx, id);
  if (p.status !== "PENDING") throw new ConflictError("This profile isn't waiting for approval.");
  if (decision === "REJECT") {
    const after = await tx.appetiteProfile.update({ where: { id }, data: { status: "DRAFT" } });
    await recordAudit(tx, ctx, { action: "appetite.profile.reject", entityType: "appetite_profile", entityId: id, before: p, after });
    return;
  }
  if (!(await hasSource(tx, "APPETITE_PROFILE", id))) throw new ValidationError("An approved profile needs a source.");
  const cadence = await numberSetting(SETTING.appetiteReviewDays, tx);
  const now = new Date();
  const previous = await tx.appetiteProfile.findMany({ where: { carrierProductId: p.carrierProductId, marketChannelId: p.marketChannelId, status: "APPROVED" } });
  for (const old of previous) {
    // The old version ends the day before the new one starts (unless it already ended earlier).
    let effectiveTo = old.effectiveTo && old.effectiveTo < p.effectiveFrom! ? old.effectiveTo : addDays(p.effectiveFrom!, -1);
    // If the new version starts on or before the old one's start, the old one ends the day it began.
    if (old.effectiveFrom && effectiveTo < old.effectiveFrom) effectiveTo = old.effectiveFrom;
    const retired = await tx.appetiteProfile.update({ where: { id: old.id }, data: { status: "RETIRED", effectiveTo } });
    await recordAudit(tx, ctx, { action: "appetite.profile.retire", entityType: "appetite_profile", entityId: old.id, before: old, after: { ...retired, replacedBy: id } });
  }
  const after = await tx.appetiteProfile.update({
    where: { id },
    data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: now, verifiedAt: now, nextReviewAt: addDays(now, cadence) },
  });
  await tx.verificationEvent.create({ data: { recordType: "APPETITE_PROFILE", recordId: id, verifiedById: ctx.userId, verifiedAt: now, nextReviewAt: after.nextReviewAt, sourceNote: "Approved" } });
  await recordAudit(tx, ctx, { action: "appetite.profile.approve", entityType: "appetite_profile", entityId: id, before: p, after });
}

/** Withdraw a submission (submitter only): back to DRAFT. */
export async function withdrawProfile(ctx: AuthContext, id: string) {
  assertCan(ctx, "appetite.write");
  return prisma.$transaction(async (tx) => {
    const p = await findProfile(tx, id);
    const cr = await pendingRequestFor(tx, "APPETITE_PROFILE", id);
    if (p.status !== "PENDING" || !cr) throw new ConflictError("This profile isn't waiting for approval.");
    if (cr.proposedById !== ctx.userId) throw new ConflictError("Only the person who submitted it can withdraw it.");
    await closeChangeRequest(tx, ctx, cr.id, "WITHDRAWN", null);
    const after = await tx.appetiteProfile.update({ where: { id }, data: { status: "DRAFT" } });
    await recordAudit(tx, ctx, { action: "appetite.profile.withdraw", entityType: "appetite_profile", entityId: id, before: p, after });
  });
}

/** "Confirm still current" for an approved profile. */
export async function verifyProfile(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  const { sourceNote } = parse(z.object({ sourceNote: requiredText(500) }), input);
  const cadence = await numberSetting(SETTING.appetiteReviewDays);
  return prisma.$transaction(async (tx) => {
    const before = await findProfile(tx, id);
    if (before.status !== "APPROVED") throw new ConflictError("Only approved profiles are confirmed. Drafts are reviewed when approved.");
    const now = new Date();
    const after = await tx.appetiteProfile.update({ where: { id }, data: { verifiedAt: now, nextReviewAt: addDays(now, cadence) } });
    await tx.verificationEvent.create({ data: { recordType: "APPETITE_PROFILE", recordId: id, verifiedById: ctx.userId, verifiedAt: now, nextReviewAt: after.nextReviewAt, sourceNote } });
    await recordAudit(tx, ctx, { action: "appetite.profile.verify", entityType: "appetite_profile", entityId: id, before: { verifiedAt: before.verifiedAt, nextReviewAt: before.nextReviewAt }, after: { verifiedAt: after.verifiedAt, nextReviewAt: after.nextReviewAt, sourceNote } });
  });
}

export { typedValueFor };

const closeOutSchema = z.object({ effectiveTo: optionalDate, reason: requiredText(2000) });

/**
 * Closes out an approved appetite version (Josh, 2026-11-10): it ends on the given date (today
 * by default) and is retired, so the Market Finder stops using it. Needs appetite approval
 * permission and a reason, like an approval (D14).
 */
export async function closeOutProfile(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  assertCan(ctx, "appetite.approve");
  const { effectiveTo, reason } = parse(closeOutSchema, input);
  if (reason.trim().length < 10) throw new ValidationError("Say why it's being closed out (at least 10 characters).");
  const today = new Date(new Date().toISOString().slice(0, 10));
  const end = effectiveTo ?? today;
  if (end > today) throw new ValidationError("Pick today or an earlier date. To end it in the future, start a new version with an end date.");
  return prisma.$transaction(async (tx) => {
    const p = await findProfile(tx, id);
    if (p.status !== "APPROVED") throw new ConflictError(p.status === "DRAFT" ? "This is a draft: delete it instead." : "Only an approved version can be closed out.");
    if (p.effectiveFrom && end < p.effectiveFrom) throw new ValidationError("The end date can't be before it took effect.");
    const after = await tx.appetiteProfile.update({ where: { id }, data: { status: "RETIRED", effectiveTo: end } });
    await recordAudit(tx, ctx, { action: "appetite.profile.close_out", entityType: "appetite_profile", entityId: id, before: p, after: { ...after, reason: reason.trim() } });
    return after;
  });
}
