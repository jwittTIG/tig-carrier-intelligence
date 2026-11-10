import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { RecordType } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit";
import { assertCan, can, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parse } from "@/server/validation";
import { appetiteExtractor, EXTRACT_PROMPT_VERSION, ProposalsSchema, type Proposals } from "@/server/ai/appetite-extractor";
import { addAttributeDefinition, addCoverage, addRequirement, addRule, allowedValuesOf, copyRules, createProfile, removeCoverage, removeRequirement, removeRule, updateProfile } from "./appetite";
import { addSource } from "./sources";

/**
 * AI-drafted appetite (M9, DECISIONS N22). One AI read of a guide proposes risk details, rules,
 * limits and requirements for a carrier product. A person picks what to keep; rules go into an
 * appetite DRAFT (still approved by someone, D14), limits and requirements onto the product.
 * Every applied item records an AI_EXTRACTED source with page, quote and confidence.
 */

const startSchema = z.object({ documentVersionId: z.uuid(), carrierProductId: z.uuid() });

/** Products of the guide's carrier that a draft can be made for. */
export async function draftTargets(ctx: AuthContext, documentId: string) {
  assertCan(ctx, "appetite.write");
  const filed = await prisma.recordSource.findMany({
    where: { recordType: "ORGANIZATION", documentVersion: { documentId } },
    select: { recordId: true },
  });
  const orgIds = [...new Set(filed.map((f) => f.recordId))];
  return prisma.carrierProduct.findMany({
    where: { writingCompanyId: { in: orgIds }, archivedAt: null },
    include: { product: { include: { line: true } }, writingCompany: { select: { displayName: true } } },
    orderBy: [{ writingCompany: { displayName: "asc" } }, { product: { name: "asc" } }],
  });
}

/** The guide version and product to read, checked: active, not restricted, PDF, AI set up. */
async function readable(documentVersionId: string, carrierProductId: string) {
  const version = await prisma.documentVersion.findUnique({ where: { id: documentVersionId }, include: { document: true } });
  if (!version || version.document.status !== "ACTIVE") throw new NotFoundError("Guide not found.");
  if (version.document.classification === "RESTRICTED") throw new ValidationError("Restricted documents are never sent to the AI.");
  if (version.mimeType !== "application/pdf") throw new ValidationError("Only PDF guides can be read for now.");
  const cp = await prisma.carrierProduct.findUnique({ where: { id: carrierProductId }, include: { writingCompany: true, product: { include: { line: true, attributeDefinitions: { orderBy: { key: "asc" } } } } } });
  if (!cp) throw new NotFoundError("Carrier product not found.");
  const extractor = appetiteExtractor();
  if (!extractor) throw new ValidationError("AI isn't set up yet: add ANTHROPIC_API_KEY to .env.local and restart the app.");
  return { version, cp, extractor };
}

/** One AI read. Never throws for an AI failure: it comes back as `error`. */
async function read({ version, cp, extractor }: Awaited<ReturnType<typeof readable>>) {
  try {
    const out = await extractor.extract({
      doc: { documentVersionId: version.id, title: version.document.title, versionNumber: version.versionNumber, objectKey: version.objectKey, mimeType: version.mimeType },
      carrierName: cp.writingCompany.displayName,
      productName: cp.product.name,
      lineName: cp.product.line.name,
      existingAttributes: cp.product.attributeDefinitions.map((a) => ({ key: a.key, label: a.label, dataType: a.dataType, unit: a.unit, allowedValues: allowedValuesOf(a.validationSchema) })),
    });
    return { out, error: null };
  } catch (e) {
    return { out: null, error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 1000) : "Unknown error" };
  }
}

const readData = (r: Awaited<ReturnType<typeof read>>, mode: string) => ({
  status: r.out ? ("READY" as const) : ("FAILED" as const),
  proposals: (r.out?.proposals ?? {}) as unknown as Prisma.InputJsonValue,
  model: r.out?.model ?? (mode === "dev" ? "dev-reader" : "claude-opus-5-5"),
  usage: (r.out?.usage ?? undefined) as Prisma.InputJsonValue | undefined,
  costUsd: r.out?.costUsd != null ? new Prisma.Decimal(r.out.costUsd.toFixed(4)) : null,
  error: r.error,
});

/** Reads a guide now (the person waits) and keeps the proposals for review. */
export async function startExtraction(ctx: AuthContext, input: unknown) {
  assertCan(ctx, "appetite.write");
  assertCan(ctx, "document.read");
  const { documentVersionId, carrierProductId } = parse(startSchema, input);
  const target = await readable(documentVersionId, carrierProductId);
  const data = readData(await read(target), target.extractor.mode);
  return prisma.$transaction(async (tx) => {
    const row = await tx.guideExtraction.create({ data: { ...data, documentVersionId, carrierProductId, promptVersion: EXTRACT_PROMPT_VERSION, createdById: ctx.userId } });
    await recordAudit(tx, ctx, { action: "appetite.extraction.run", entityType: "guide_extraction", entityId: row.id, after: { id: row.id, status: row.status, documentVersionId, carrierProductId, model: row.model, costUsd: row.costUsd, error: row.error } });
    return row;
  });
}

/** A background read that hasn't finished after this long is treated as stopped (the app restarted). */
export const RUNNING_TIMEOUT_MS = 20 * 60 * 1000;
export const isStalled = (x: { status: string; createdAt: Date }) => x.status === "RUNNING" && Date.now() - x.createdAt.getTime() > RUNNING_TIMEOUT_MS;

/**
 * A new version of a guide that already has drafted appetite (N24): queues a read of the new
 * version for the same product. Returns the queued row's id, or null when there's nothing to
 * update (never drafted, AI off, restricted, not a PDF). Run it with `runQueuedExtraction`.
 */
export async function queueAutoDraft(ctx: AuthContext, documentVersionId: string): Promise<string | null> {
  if (!can(ctx, "appetite.write") || !can(ctx, "document.read")) return null;
  const version = await prisma.documentVersion.findUnique({ where: { id: documentVersionId } });
  if (!version) return null;
  const prior = await prisma.guideExtraction.findFirst({
    where: { documentVersion: { documentId: version.documentId, versionNumber: { lt: version.versionNumber } }, carrierProduct: { archivedAt: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!prior) return null;
  let target;
  try {
    target = await readable(version.id, prior.carrierProductId);
  } catch (e) {
    if (e instanceof ValidationError || e instanceof NotFoundError) return null;
    throw e;
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.guideExtraction.create({
      data: { documentVersionId: version.id, carrierProductId: prior.carrierProductId, status: "RUNNING", model: target.extractor.mode === "dev" ? "dev-reader" : "claude-opus-5-5", promptVersion: EXTRACT_PROMPT_VERSION, createdById: ctx.userId },
    });
    await recordAudit(tx, ctx, { action: "appetite.extraction.queue", entityType: "guide_extraction", entityId: row.id, after: { id: row.id, documentVersionId: version.id, carrierProductId: prior.carrierProductId, replaces: prior.id } });
    return row.id;
  });
}

/** Runs a queued read (after the upload's response has gone). Safe to call twice. */
export async function runQueuedExtraction(ctx: AuthContext, id: string) {
  const row = await prisma.guideExtraction.findUnique({ where: { id } });
  if (!row || row.status !== "RUNNING") return;
  let data;
  try {
    const target = await readable(row.documentVersionId, row.carrierProductId);
    data = readData(await read(target), target.extractor.mode);
  } catch (e) {
    data = { status: "FAILED" as const, error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) };
  }
  await prisma.$transaction(async (tx) => {
    const done = await tx.guideExtraction.updateMany({ where: { id, status: "RUNNING" }, data });
    if (!done.count) return;
    await recordAudit(tx, ctx, { action: "appetite.extraction.run", entityType: "guide_extraction", entityId: id, after: { id, status: data.status, error: data.error, background: true } });
  });
}

type ExtractionRow = Prisma.GuideExtractionGetPayload<{ include: { documentVersion: { select: { versionNumber: true; documentId: true } }; carrierProduct: { include: { product: { select: { name: true } } } } } }>;
export type GuideAppetite = {
  /** The newest read of the guide's latest version (what the page shows), if any. */
  current: (ExtractionRow & { stalled: boolean }) | null;
  /** When the latest version hasn't been read: the newest read of an earlier version (its product is reused). */
  earlier: ExtractionRow | null;
  /** The appetite version an applied read went into. */
  profile: { id: string; version: number; status: string } | null;
  history: ExtractionRow[];
};

/** Where each guide's appetite stands, for the latest version of each guide. */
export async function guideAppetite(ctx: AuthContext, guides: { documentId: string; documentVersionId: string }[]): Promise<Map<string, GuideAppetite>> {
  assertCan(ctx, "appetite.read");
  const rows = await prisma.guideExtraction.findMany({
    where: { documentVersion: { documentId: { in: guides.map((g) => g.documentId) } } },
    orderBy: { createdAt: "desc" },
    include: { documentVersion: { select: { versionNumber: true, documentId: true } }, carrierProduct: { include: { product: { select: { name: true } } } } },
  });
  const profileIds = rows.map((r) => r.profileId).filter((x): x is string => !!x);
  const profiles = new Map((await prisma.appetiteProfile.findMany({ where: { id: { in: profileIds } }, select: { id: true, version: true, status: true } })).map((p) => [p.id, p]));
  const out = new Map<string, GuideAppetite>();
  for (const g of guides) {
    const history = rows.filter((r) => r.documentVersion.documentId === g.documentId);
    const cur = history.find((r) => r.documentVersionId === g.documentVersionId) ?? null;
    out.set(g.documentId, {
      current: cur && { ...cur, stalled: isStalled(cur) },
      earlier: cur ? null : (history[0] ?? null),
      profile: cur?.profileId ? (profiles.get(cur.profileId) ?? null) : null,
      history,
    });
  }
  return out;
}

export async function getExtraction(ctx: AuthContext, id: string) {
  assertCan(ctx, "appetite.read");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Draft not found.");
  const row = await prisma.guideExtraction.findUnique({
    where: { id },
    include: {
      documentVersion: { include: { document: { select: { id: true, title: true } } } },
      carrierProduct: { include: { writingCompany: { select: { id: true, displayName: true } }, product: { include: { line: true, attributeDefinitions: true } } } },
      createdBy: { select: { name: true } },
    },
  });
  if (!row) throw new NotFoundError("Draft not found.");
  const parsed = ProposalsSchema.safeParse(row.proposals);
  return { ...row, proposals: parsed.success ? parsed.data : null, existingKeys: row.carrierProduct.product.attributeDefinitions.map((a) => a.key) };
}

export async function listExtractions(ctx: AuthContext, opts: { carrierId?: string; documentId?: string } = {}) {
  assertCan(ctx, "appetite.read");
  return prisma.guideExtraction.findMany({
    where: {
      ...(opts.carrierId && { carrierProduct: { writingCompanyId: opts.carrierId } }),
      ...(opts.documentId && { documentVersion: { documentId: opts.documentId } }),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { documentVersion: { include: { document: { select: { title: true } } } }, carrierProduct: { include: { product: { select: { name: true } } } }, createdBy: { select: { name: true } } },
  });
}

const indexes = z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" && v !== "" ? [v] : []), z.array(z.coerce.number().int().min(0).max(10000)));
const applySchema = z.object({ attributes: indexes, rules: indexes, limits: indexes, requirements: indexes });

type Section = "attributes" | "rules" | "limits" | "requirements";
type Selection = Record<Section, number[]>;
/** A proposal that couldn't be added, with where it sits in the proposals (for a retry). */
type Skipped = { kind: string; section?: Section; index?: number; summary: string; reason: string };
type Counts = { rules: number; limits: number; requirements: number };
type ApplyResult = { profileId: string; added: { riskDetails: number } & Counts; skipped: Skipped[]; replaced?: Counts; keptHandRules?: number };

/** Ids among `ids` that the AI drafted from a guide version other than `versionId` (an older or replaced guide). */
async function aiFromOtherGuides(recordType: RecordType, ids: string[], versionId: string): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await prisma.recordSource.findMany({ where: { recordType, recordId: { in: ids }, sourceKind: "AI_EXTRACTED", documentVersionId: { not: versionId } }, select: { recordId: true } });
  return [...new Set(rows.map((r) => r.recordId))];
}

/** Rules with no AI source: added by hand, so they survive a guide replacing the AI-drafted ones. */
async function handRuleIds(ruleIds: string[]): Promise<string[]> {
  if (!ruleIds.length) return [];
  const ai = new Set((await prisma.recordSource.findMany({ where: { recordType: "APPETITE_RULE", recordId: { in: ruleIds }, sourceKind: "AI_EXTRACTED" }, select: { recordId: true } })).map((r) => r.recordId));
  return ruleIds.filter((id) => !ai.has(id));
}

async function aiSource(ctx: AuthContext, recordType: RecordType, recordId: string, versionId: string, item: { page: number; quote: string; confidence: number }) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.recordSource.create({
      data: {
        recordType,
        recordId,
        sourceKind: "AI_EXTRACTED",
        documentVersionId: versionId,
        pageOrSection: `p. ${item.page}`,
        sourceNote: `“${item.quote.slice(0, 900)}” (quote as read by AI; check the page)`,
        confidence: new Prisma.Decimal(Math.min(1, Math.max(0, item.confidence)).toFixed(3)),
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, { action: "source.add", entityType: "record_source", entityId: row.id, after: row });
  });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
/** Fits AI text into a field, marking that it was shortened. */
const fit = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/**
 * Adds the selected proposals to a draft. Items that don't fit (an unknown state, a value that
 * isn't allowed, a rule whose risk detail is missing) are skipped and reported, not guessed.
 */
async function applyItems(ctx: AuthContext, ex: Awaited<ReturnType<typeof getExtraction>>, sel: Selection, draftId: string | null): Promise<ApplyResult> {
  const p = ex.proposals!;
  const picked = <T,>(list: T[], idx: number[]) => [...new Set(idx)].filter((i) => i < list.length).map((i) => ({ i, item: list[i] }));
  const skipped: Skipped[] = [];
  const productId = ex.carrierProduct.productId;
  const versionId = ex.documentVersionId;

  // 1. Risk details: reuse by key (also ones added since), else create the selected ones.
  const current = await prisma.riskAttributeDefinition.findMany({ where: { productId }, select: { key: true, id: true } });
  const defs = new Map(current.map((a) => [a.key, a.id]));
  const failedKeys = new Set<string>();
  let newDetails = 0;
  for (const { i, item: a } of picked(p.attributes, sel.attributes)) {
    const key = a.key.trim().toLowerCase();
    if (defs.has(key)) continue;
    try {
      const row = await addAttributeDefinition(ctx, productId, { key, label: fit(a.label, 80), dataType: a.dataType, unit: fit(a.unit ?? "", 20), allowedValues: a.dataType === "ENUM" ? (a.allowedValues ?? []).map((v) => fit(v, 80)) : [] });
      defs.set(key, row.id);
      newDetails++;
    } catch (e) {
      failedKeys.add(key);
      skipped.push({ kind: "Risk detail", section: "attributes", index: i, summary: a.label, reason: errText(e) });
    }
  }

  // 2. The draft: the given one (retry), an open one for this product, or a new one. The guide is its source.
  //    This guide replaces the product's earlier AI-drafted rules (N24): an open draft loses rules
  //    the AI drafted from another guide version; a new version starts from the approved one's
  //    hand-added rules only.
  let profile;
  let replaced: Counts | undefined;
  let keptHandRules: number | undefined;
  if (draftId) {
    profile = await prisma.appetiteProfile.findUnique({ where: { id: draftId } });
    if (!profile || profile.status !== "DRAFT") throw new ConflictError("That appetite draft has been submitted or approved since. Start a new version, then draft from the guide again.");
  } else {
    const open = await prisma.appetiteProfile.findFirst({ where: { carrierProductId: ex.carrierProductId, marketChannelId: null, status: "DRAFT" } });
    if (!open && (await prisma.appetiteProfile.findFirst({ where: { carrierProductId: ex.carrierProductId, marketChannelId: null, status: "PENDING" } }))) {
      throw new ConflictError("A version of this product's appetite is waiting for approval. Decide it first, then apply this draft.");
    }
    const effective = p.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate) ? p.effectiveDate : "";
    replaced = { rules: 0, limits: 0, requirements: 0 };
    if (open) {
      profile = open;
      const ruleIds = (await prisma.appetiteRule.findMany({ where: { profileId: open.id }, select: { id: true } })).map((r) => r.id);
      for (const id of await aiFromOtherGuides("APPETITE_RULE", ruleIds, versionId)) {
        await removeRule(ctx, open.id, id);
        replaced.rules++;
      }
      // An open draft without a date takes the guide's.
      if (!open.effectiveFrom && effective) await updateProfile(ctx, open.id, { effectiveFrom: effective });
    } else {
      profile = await createProfile(ctx, { carrierProductId: ex.carrierProductId, effectiveFrom: effective });
      const approved = await prisma.appetiteProfile.findFirst({ where: { carrierProductId: ex.carrierProductId, marketChannelId: null, status: "APPROVED" }, orderBy: { version: "desc" }, include: { rules: { include: { territories: true, industries: true } } } });
      if (approved) {
        const keep = new Set(await handRuleIds(approved.rules.map((r) => r.id)));
        const newProfileId = profile.id;
        const kept = await prisma.$transaction(async (tx) => {
          const ids = await copyRules(tx, approved.rules.filter((r) => keep.has(r.id)), newProfileId);
          await recordAudit(tx, ctx, { action: "appetite.rule.carry_forward", entityType: "appetite_profile", entityId: newProfileId, after: { fromProfileId: approved.id, handRules: ids.length, replacedAiRules: approved.rules.length - ids.length } });
          return ids.length;
        });
        keptHandRules = kept;
        replaced.rules = approved.rules.length - kept;
      }
    }
  }
  const cited = await prisma.recordSource.findFirst({ where: { recordType: "APPETITE_PROFILE", recordId: profile.id, documentVersionId: versionId } });
  if (!cited) await addSource(ctx, { recordType: "APPETITE_PROFILE", recordId: profile.id, sourceKind: "DOCUMENT", documentVersionId: versionId, sourceNote: "Drafted by AI from this guide; reviewed before use" });

  // 3. Rules.
  const states = await prisma.territory.findMany({ where: { territoryType: "STATE", countryCode: "US" }, select: { id: true, stateCode: true } });
  const stateId = new Map(states.map((st) => [st.stateCode!, st.id]));
  let rules = 0;
  for (const { i, item: r } of picked(p.rules, sel.rules)) {
    const skip = (reason: string) => skipped.push({ kind: "Rule", section: "rules", index: i, summary: r.summary, reason });
    const unknownStates = r.states.filter((c) => !stateId.has(c.toUpperCase()));
    if (unknownStates.length) { skip(`Unknown state code ${unknownStates.join(", ")}`); continue; }
    const key = r.attributeKey?.trim().toLowerCase();
    const attrId = key ? defs.get(key) : undefined;
    if (key && !attrId) { skip(failedKeys.has(key) ? `Its risk detail "${key}" couldn't be added (see above)` : `Needs the risk detail "${key}", which wasn't selected`); continue; }
    try {
      const rule = await addRule(ctx, profile.id, {
        outcome: r.outcome,
        territoryIds: r.states.map((c) => stateId.get(c.toUpperCase())!),
        industries: r.naics.map((n) => `NAICS ${n}`).join(", "),
        attributeDefinitionId: attrId ?? "",
        operator: attrId ? (r.operator ?? "") : "",
        value: attrId ? (r.value ?? "") : "",
        rationale: fit(`${r.summary} (p. ${r.page})`, 2000),
      });
      await aiSource(ctx, "APPETITE_RULE", rule.id, versionId, r);
      rules++;
    } catch (e) {
      skip(errText(e));
    }
  }

  // 4. Limits and requirements, on the carrier product. When this guide brings new ones, the ones
  //    the AI drafted from another guide version are removed (hand-added ones stay).
  if (replaced && sel.limits.length) {
    const ids = (await prisma.coverageCapability.findMany({ where: { carrierProductId: ex.carrierProductId }, select: { id: true } })).map((r) => r.id);
    for (const id of await aiFromOtherGuides("COVERAGE_CAPABILITY", ids, versionId)) {
      await removeCoverage(ctx, ex.carrierProductId, id);
      replaced.limits++;
    }
  }
  if (replaced && sel.requirements.length) {
    const ids = (await prisma.underwritingRequirement.findMany({ where: { carrierProductId: ex.carrierProductId }, select: { id: true } })).map((r) => r.id);
    for (const id of await aiFromOtherGuides("UNDERWRITING_REQUIREMENT", ids, versionId)) {
      await removeRequirement(ctx, ex.carrierProductId, id);
      replaced.requirements++;
    }
  }
  let limits = 0;
  for (const { i, item: l } of picked(p.limits, sel.limits)) {
    try {
      const row = await addCoverage(ctx, ex.carrierProductId, { coverageCode: fit(l.coverage, 60), minLimit: l.minLimit != null ? String(l.minLimit) : "", maxLimit: l.maxLimit != null ? String(l.maxLimit) : "" });
      await aiSource(ctx, "COVERAGE_CAPABILITY", row.id, versionId, l);
      limits++;
    } catch (e) {
      skipped.push({ kind: "Limit", section: "limits", index: i, summary: l.coverage, reason: errText(e) });
    }
  }
  let requirements = 0;
  for (const { i, item: q } of picked(p.requirements, sel.requirements)) {
    try {
      const row = await addRequirement(ctx, ex.carrierProductId, { requirementType: fit(q.type, 80), description: fit(q.description, 2000), sourceDocumentVersionId: versionId });
      await aiSource(ctx, "UNDERWRITING_REQUIREMENT", row.id, versionId, q);
      requirements++;
    } catch (e) {
      skipped.push({ kind: "Requirement", section: "requirements", index: i, summary: q.type, reason: errText(e) });
    }
  }
  return { profileId: profile.id, added: { riskDetails: newDetails, rules, limits, requirements }, skipped, ...(replaced && { replaced }), ...(keptHandRules !== undefined && { keptHandRules }) };
}

/** Applies the selected proposals to a draft (once per AI read). */
export async function applyExtraction(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  const sel = parse(applySchema, input);
  const ex = await getExtraction(ctx, id);
  if (ex.status !== "READY" || !ex.proposals) throw new ConflictError(ex.status === "APPLIED" ? "This draft was already applied." : ex.status === "RUNNING" ? "AI is still reading the guide. Try again in a few minutes." : "Nothing to apply.");
  const result = await applyItems(ctx, ex, sel, null);
  await prisma.$transaction(async (tx) => {
    await tx.guideExtraction.update({ where: { id }, data: { status: "APPLIED", profileId: result.profileId, appliedAt: new Date(), result: result as unknown as Prisma.InputJsonValue } });
    await recordAudit(tx, ctx, { action: "appetite.extraction.apply", entityType: "guide_extraction", entityId: id, after: result });
  });
  return result;
}

/** Where a skipped item sits in the proposals (older results only have its kind and summary). */
function locate(p: Proposals, s: Skipped): { section: Section; index: number } | null {
  if (s.section && s.index !== undefined) return { section: s.section, index: s.index };
  const find = (section: Section, list: { summary?: string; label?: string; coverage?: string; type?: string }[], name: (x: (typeof list)[number]) => string | undefined) => {
    const index = list.findIndex((x) => name(x) === s.summary);
    return index >= 0 ? { section, index } : null;
  };
  if (s.kind === "Risk detail") return find("attributes", p.attributes, (x) => x.label);
  if (s.kind === "Rule") return find("rules", p.rules, (x) => x.summary);
  if (s.kind === "Limit") return find("limits", p.limits, (x) => x.coverage);
  if (s.kind === "Requirement") return find("requirements", p.requirements, (x) => x.type);
  return null;
}

/**
 * Tries the skipped items of an applied AI draft again, into the same appetite draft (for
 * example after a fix). Anything still skipped stays listed with its reason.
 */
export async function retrySkipped(ctx: AuthContext, id: string) {
  assertCan(ctx, "appetite.write");
  const ex = await getExtraction(ctx, id);
  const prev = ex.result as ApplyResult | null;
  if (ex.status !== "APPLIED" || !prev || !ex.proposals) throw new ConflictError("Only an applied AI draft can be retried.");
  if (!prev.skipped.length) throw new ConflictError("Nothing was skipped.");
  const sel: Selection = { attributes: [], rules: [], limits: [], requirements: [] };
  const unknown: Skipped[] = [];
  for (const s of prev.skipped) {
    const at = locate(ex.proposals, s);
    if (at) sel[at.section].push(at.index);
    else unknown.push(s);
  }
  // A skipped rule needs its risk detail again too (it's reused if it exists by now).
  for (const i of sel.rules) {
    const key = ex.proposals.rules[i]?.attributeKey?.trim().toLowerCase();
    const a = key ? ex.proposals.attributes.findIndex((x) => x.key.trim().toLowerCase() === key) : -1;
    if (a >= 0 && !sel.attributes.includes(a)) sel.attributes.push(a);
  }
  const again = await applyItems(ctx, ex, sel, prev.profileId);
  const result: ApplyResult = {
    profileId: prev.profileId,
    added: {
      riskDetails: prev.added.riskDetails + again.added.riskDetails,
      rules: prev.added.rules + again.added.rules,
      limits: prev.added.limits + again.added.limits,
      requirements: prev.added.requirements + again.added.requirements,
    },
    skipped: [...again.skipped, ...unknown],
    ...(prev.replaced && { replaced: prev.replaced }),
    ...(prev.keptHandRules !== undefined && { keptHandRules: prev.keptHandRules }),
  };
  await prisma.$transaction(async (tx) => {
    await tx.guideExtraction.update({ where: { id }, data: { result: result as unknown as Prisma.InputJsonValue } });
    await recordAudit(tx, ctx, { action: "appetite.extraction.retry", entityType: "guide_extraction", entityId: id, before: prev, after: { ...result, retried: again.added } });
  });
  return { ...result, retried: again.added };
}
