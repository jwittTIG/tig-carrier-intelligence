import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { RecordType } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parse } from "@/server/validation";
import { appetiteExtractor, EXTRACT_PROMPT_VERSION, ProposalsSchema, type Proposals } from "@/server/ai/appetite-extractor";
import { addAttributeDefinition, addCoverage, addRequirement, addRule, allowedValuesOf, createProfile, updateProfile } from "./appetite";
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

export async function startExtraction(ctx: AuthContext, input: unknown) {
  assertCan(ctx, "appetite.write");
  assertCan(ctx, "document.read");
  const { documentVersionId, carrierProductId } = parse(startSchema, input);
  const version = await prisma.documentVersion.findUnique({ where: { id: documentVersionId }, include: { document: true } });
  if (!version || version.document.status !== "ACTIVE") throw new NotFoundError("Guide not found.");
  if (version.document.classification === "RESTRICTED") throw new ValidationError("Restricted documents are never sent to the AI.");
  if (version.mimeType !== "application/pdf") throw new ValidationError("Only PDF guides can be read for now.");
  const cp = await prisma.carrierProduct.findUnique({ where: { id: carrierProductId }, include: { writingCompany: true, product: { include: { line: true, attributeDefinitions: { orderBy: { key: "asc" } } } } } });
  if (!cp) throw new NotFoundError("Carrier product not found.");
  const extractor = appetiteExtractor();
  if (!extractor) throw new ValidationError("AI isn't set up yet: add ANTHROPIC_API_KEY to .env.local and restart the app.");

  let out: Awaited<ReturnType<typeof extractor.extract>> | null = null;
  let error: string | null = null;
  try {
    out = await extractor.extract({
      doc: { documentVersionId: version.id, title: version.document.title, versionNumber: version.versionNumber, objectKey: version.objectKey, mimeType: version.mimeType },
      carrierName: cp.writingCompany.displayName,
      productName: cp.product.name,
      lineName: cp.product.line.name,
      existingAttributes: cp.product.attributeDefinitions.map((a) => ({ key: a.key, label: a.label, dataType: a.dataType, unit: a.unit, allowedValues: allowedValuesOf(a.validationSchema) })),
    });
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 1000) : "Unknown error";
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.guideExtraction.create({
      data: {
        documentVersionId: version.id,
        carrierProductId: cp.id,
        status: out ? "READY" : "FAILED",
        proposals: (out?.proposals ?? {}) as unknown as Prisma.InputJsonValue,
        model: out?.model ?? (extractor.mode === "dev" ? "dev-reader" : "claude-opus-5-5"),
        promptVersion: EXTRACT_PROMPT_VERSION,
        usage: (out?.usage ?? undefined) as Prisma.InputJsonValue | undefined,
        costUsd: out?.costUsd != null ? new Prisma.Decimal(out.costUsd.toFixed(4)) : null,
        error,
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, { action: "appetite.extraction.run", entityType: "guide_extraction", entityId: row.id, after: { id: row.id, status: row.status, documentVersionId: row.documentVersionId, carrierProductId: row.carrierProductId, model: row.model, costUsd: row.costUsd, error } });
    return row;
  });
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
type ApplyResult = { profileId: string; added: { riskDetails: number; rules: number; limits: number; requirements: number }; skipped: Skipped[] };

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
  let profile;
  if (draftId) {
    profile = await prisma.appetiteProfile.findUnique({ where: { id: draftId } });
    if (!profile || profile.status !== "DRAFT") throw new ConflictError("That appetite draft has been submitted or approved since. Start a new version, then draft from the guide again.");
  } else {
    const open = await prisma.appetiteProfile.findFirst({ where: { carrierProductId: ex.carrierProductId, marketChannelId: null, status: "DRAFT" } });
    if (!open && (await prisma.appetiteProfile.findFirst({ where: { carrierProductId: ex.carrierProductId, marketChannelId: null, status: "PENDING" } }))) {
      throw new ConflictError("A version of this product's appetite is waiting for approval. Decide it first, then apply this draft.");
    }
    const effective = p.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate) ? p.effectiveDate : "";
    profile = open ?? (await createProfile(ctx, { carrierProductId: ex.carrierProductId, effectiveFrom: effective }));
    // An open draft without a date takes the guide's.
    if (open && !open.effectiveFrom && effective) await updateProfile(ctx, open.id, { effectiveFrom: effective });
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

  // 4. Limits and requirements, on the carrier product.
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
  return { profileId: profile.id, added: { riskDetails: newDetails, rules, limits, requirements }, skipped };
}

/** Applies the selected proposals to a draft (once per AI read). */
export async function applyExtraction(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  const sel = parse(applySchema, input);
  const ex = await getExtraction(ctx, id);
  if (ex.status !== "READY" || !ex.proposals) throw new ConflictError(ex.status === "APPLIED" ? "This draft was already applied." : "Nothing to apply.");
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
  };
  await prisma.$transaction(async (tx) => {
    await tx.guideExtraction.update({ where: { id }, data: { result: result as unknown as Prisma.InputJsonValue } });
    await recordAudit(tx, ctx, { action: "appetite.extraction.retry", entityType: "guide_extraction", entityId: id, before: prev, after: { ...result, retried: again.added } });
  });
  return { ...result, retried: again.added };
}
