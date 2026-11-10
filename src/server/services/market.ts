import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { AppetiteOutcome } from "@/generated/prisma/enums";
import { todayUtc } from "@/lib/dates";
import { chooseOutcome, evaluateCondition, normalizeInput, type ConditionState, type DataType, type Evaluation, type Operator } from "@/lib/matching";
import { assertCan, can, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { optionalId, optionalText, parse } from "@/server/validation";
import { allowedValuesOf } from "./appetite";
import { resolveIndustry, type IndustryChoice } from "./industries";
import { SETTING, textSetting } from "./settings";
import { MARKET_CONTACT_ROLES } from "@/lib/contact-roles";

/**
 * Market Finder (PRD screen 4) with risk matching (M7, DECISIONS D21). Filters APPROVED
 * appetite in effect today by line/product, state, industry code, an optional limit, and the
 * risk attributes staff enter (`a_<key>` fields). Results never imply eligibility, coverage or binding.
 *
 * Outcome for a carrier product: the first applying rule, ordered by priority (lower first)
 * then specificity (attribute condition, industry, state, general). A rule with an attribute
 * applies only when its condition is met. If a rule ranked ahead has a value that wasn't
 * entered (or can't be compared) and a different outcome, the result needs information:
 * missing data is never eligible. No applying rule → UNKNOWN.
 */

export type MarketGroup = AppetiteOutcome | "NEEDS_INFO";
const GROUP_ORDER: MarketGroup[] = ["PREFERRED", "ACCEPTED", "REFERRAL", "NEEDS_INFO", "PROHIBITED", "UNKNOWN"];

const findSchema = z
  .object({
    lineId: optionalId,
    productId: optionalId,
    stateCode: z.preprocess((v) => (v === "" ? undefined : typeof v === "string" ? v.toUpperCase() : v), z.string().length(2).optional()),
    /** A code ("238160", "NAICS 238160") or words ("roofing"). */
    industry: optionalText(100),
    limit: z.preprocess((v) => (typeof v === "string" ? v.replace(/[$,\s]/g, "") : v), z.union([z.literal(""), z.string().regex(/^\d+(\.\d+)?$/, "Limit must be an amount")]).optional()).transform((v) => (v ? Number(v) : null)),
    includeIntermediaries: z.preprocess((v) => v === undefined || v === true || v === "on" || v === "true", z.boolean()).default(true),
  })
  .refine((f) => !!(f.lineId || f.productId), { message: "Choose a line or product", path: ["lineId"] });

export type MarketFilters = z.input<typeof findSchema>;

const ruleInclude = {
  territories: { select: { territoryId: true } },
  industries: { select: { classificationSystem: true, code: true } },
  attributeDefinition: { select: { key: true, label: true, unit: true, dataType: true } },
} satisfies Prisma.AppetiteRuleInclude;
type Rule = Prisma.AppetiteRuleGetPayload<{ include: typeof ruleInclude }>;

/** NAICS is hierarchical: a rule for 2381 covers 238160. Returns every prefix of the code. */
function codesCovering(w: { classificationSystem: string; code: string }): string[] {
  if (w.classificationSystem !== "NAICS") return [w.code];
  const out: string[] = [];
  for (let i = 2; i <= w.code.length; i++) out.push(w.code.slice(0, i));
  return out;
}

/**
 * Database-side rule filter: a rule matches when it names no states or one of the wanted
 * territories (the state or the whole US), and names no industries or one covering the code.
 * Without a state (or industry), only rules that don't name any can match.
 */
function ruleFilter(territoryIds: string[], wanted: { classificationSystem: string; code: string } | null, today: Date): Prisma.AppetiteRuleWhereInput {
  return {
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] },
      { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
      territoryIds.length ? { OR: [{ territories: { none: {} } }, { territories: { some: { territoryId: { in: territoryIds } } } }] } : { territories: { none: {} } },
      wanted
        ? { OR: [{ industries: { none: {} } }, { industries: { some: { classificationSystem: wanted.classificationSystem as Prisma.EnumIndustryCodeSystemFilter["equals"], code: { in: codesCovering(wanted) } } } }] }
        : { industries: { none: {} } },
    ],
  };
}

const specificity = (r: Rule) => (r.attributeDefinitionId ? 4 : 0) + (r.industries.length ? 2 : 0) + (r.territories.length ? 1 : 0);

/** Risk attributes staff can enter for a line or product, one per key. */
export async function riskAttributesFor(ctx: AuthContext, f: { lineId?: string | null; productId?: string | null }) {
  assertCan(ctx, "appetite.read");
  if (!f.productId && !f.lineId) return [];
  const defs = await prisma.riskAttributeDefinition.findMany({
    where: { searchable: true, product: f.productId ? { id: f.productId } : { lineId: f.lineId! } },
    orderBy: [{ label: "asc" }, { key: "asc" }],
    select: { key: true, label: true, dataType: true, unit: true, validationSchema: true },
  });
  return [...new Map(defs.map((d) => [d.key, { key: d.key, label: d.label, dataType: d.dataType, unit: d.unit, allowedValues: allowedValuesOf(d.validationSchema) }])).values()];
}

/** Picks `a_<key>` values out of the request. */
function riskInputs(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = k.startsWith("a_") ? k.slice(2) : null;
    if (key && /^[a-z][a-z0-9_]{1,40}$/.test(key) && typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 100);
  }
  return out;
}

type Result = {
  key: string;
  group: MarketGroup;
  /** The outcome from what was entered; for NEEDS_INFO, what it is unless a missing value changes it. */
  outcome: AppetiteOutcome;
  missing: { label: string; outcome: AppetiteOutcome; reason: string }[];
  carrierProductId: string;
  channelId: string | null;
  carrier: { id: string; displayName: string };
  product: string;
  channel: string;
  profileId: string | null;
  version: number | null;
  stale: boolean;
  nextReviewAt: Date | null;
  sources: number;
  matchedRules: { id: string; outcome: AppetiteOutcome; scope: string; rationale: string | null }[];
  conditions: { label: string; outcome: AppetiteOutcome; text: string; state: ConditionState; reason?: string }[];
  conflicting: boolean;
  limit: { state: "OK" | "BELOW" | "NOT_STATED" | "NOT_ASKED"; text: string };
  contacts: { id: string; name: string; role: string; email: string | null; phone: string | null }[];
  note: string | null;
};

export async function findMarkets(ctx: AuthContext, input: MarketFilters) {
  assertCan(ctx, "appetite.read");
  const f = parse(findSchema, input);
  const attributes = await riskAttributesFor(ctx, f);
  const entered = riskInputs(input);
  const risk = new Map<string, string>();
  const inputErrors: string[] = [];
  for (const a of attributes) {
    const n = normalizeInput(a.dataType as DataType, entered[a.key]);
    if (n.error) inputErrors.push(`${a.label}: ${n.error}`);
    else if (n.value !== null) risk.set(a.key, n.value);
  }
  if (inputErrors.length) throw new ValidationError(inputErrors.join("; "));
  const today = todayUtc();
  const disclaimer = await textSetting(SETTING.searchDisclaimer);
  // Words ("roofing") become one NAICS code, or a list for staff to choose from; nothing is searched until then.
  const resolved = f.industry ? await resolveIndustry(ctx, f.industry) : null;
  if (resolved?.kind === "choices") {
    return {
      disclaimer,
      filters: { ...f, industry: null },
      attributes,
      risk: Object.fromEntries(risk),
      industry: null,
      industryChoices: resolved.choices as IndustryChoice[],
      total: 0,
      groups: GROUP_ORDER.map((outcome) => ({ outcome, results: [] as Result[] })),
    };
  }
  const wanted = resolved ? { classificationSystem: resolved.classificationSystem, code: resolved.code } : null;

  const territories = await prisma.territory.findMany({ where: { countryCode: "US", territoryType: { in: ["STATE", "COUNTRY"] } }, select: { id: true, stateCode: true, name: true, territoryType: true } });
  const territoryById = new Map(territories.map((t) => [t.id, t]));
  const wantedTerritories = f.stateCode ? territories.filter((t) => t.stateCode === f.stateCode || t.territoryType === "COUNTRY").map((t) => t.id) : [];

  const productWhere: Prisma.InsuranceProductWhereInput = f.productId ? { id: f.productId } : { lineId: f.lineId! };
  const carrierProducts = await prisma.carrierProduct.findMany({
    where: { archivedAt: null, status: "ACTIVE", product: productWhere, writingCompany: { archivedAt: null } },
    select: {
      id: true,
      writingCompanyId: true,
      product: { select: { name: true } },
      writingCompany: { select: { id: true, displayName: true } },
      coverages: { select: { coverageCode: true, maxLimit: true } },
      channels: {
        where: { archivedAt: null, ...(f.includeIntermediaries ? {} : { intermediaryOrgId: null }) },
        select: {
          id: true,
          intermediaryOrgId: true,
          intermediary: { select: { displayName: true } },
        },
      },
      appetiteProfiles: {
        where: { status: "APPROVED", OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }], AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }] },
        select: {
          id: true,
          marketChannelId: true,
          version: true,
          nextReviewAt: true,
          _count: { select: { rules: true } },
          rules: { where: ruleFilter(wantedTerritories, wanted, today), include: ruleInclude },
        },
      },
    },
  });

  const orgIds = [...new Set(carrierProducts.flatMap((cp) => [cp.writingCompanyId, ...cp.channels.map((c) => c.intermediaryOrgId).filter((x): x is string => !!x)]))];
  const contacts = can(ctx, "contact.read")
    ? await prisma.contactAssignment.findMany({
        where: {
          organizationId: { in: orgIds },
          role: { in: MARKET_CONTACT_ROLES },
          contact: { archivedAt: null, status: "ACTIVE" },
          AND: [
            { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] },
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
            ...(f.stateCode ? [{ territory: { OR: [{ stateCode: f.stateCode }, { territoryType: "COUNTRY" as const, countryCode: "US" }] } }] : []),
          ],
        },
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, officePhone: true } } },
      })
    : [];
  const sourceCounts = await prisma.recordSource.groupBy({
    by: ["recordId"],
    where: { recordType: "APPETITE_PROFILE", recordId: { in: carrierProducts.flatMap((cp) => cp.appetiteProfiles.map((p) => p.id)) } },
    _count: true,
  });
  const sourceCount = new Map(sourceCounts.map((s) => [s.recordId, s._count]));

  const results: Result[] = [];

  for (const cp of carrierProducts) {
    // Profile per channel overrides the product-wide profile for that channel.
    const productWide = cp.appetiteProfiles.find((p) => p.marketChannelId === null) ?? null;
    const channels = cp.channels.length ? cp.channels : [null];
    for (const ch of channels) {
      const profile = (ch && cp.appetiteProfiles.find((p) => p.marketChannelId === ch.id)) || productWide;
      // Already narrowed to this state/class/date by ruleFilter in the query.
      const rules = profile?.rules ?? [];
      const evaluated = rules.map((r) => ({
        id: r.id,
        outcome: r.outcome,
        priority: r.priority,
        specificity: specificity(r),
        evaluation: evaluationFor(r, risk),
        rule: r,
      }));
      const { chosen, applying, blockers } = chooseOutcome(evaluated);
      const outcome: AppetiteOutcome = chosen?.outcome ?? "UNKNOWN";
      const conditions = evaluated.filter((e) => e.evaluation).map((e) => ({ label: e.rule.attributeDefinition!.label, outcome: e.outcome, text: conditionText(e.rule), state: e.evaluation!.state, ...(e.evaluation!.reason && { reason: e.evaluation!.reason }) }));
      const missing = blockers.map((b) => ({ label: b.rule.attributeDefinition!.label, outcome: b.outcome, reason: b.evaluation!.state === "MISSING" ? "not entered" : b.evaluation!.reason ?? "can't be compared" }));
      const cov = cp.coverages.filter((c) => c.maxLimit !== null);
      const limit: Result["limit"] =
        f.limit === null ? { state: "NOT_ASKED", text: cp.coverages.map((c) => `${c.coverageCode}: max ${c.maxLimit ? `$${Number(c.maxLimit).toLocaleString("en-US")}` : "not stated"}`).join("; ") || "Limits not stated" }
        : cov.length === 0 ? { state: "NOT_STATED", text: "Maximum limit not stated" }
        : cov.some((c) => Number(c.maxLimit) >= f.limit!) ? { state: "OK", text: `Up to $${Math.max(...cov.map((c) => Number(c.maxLimit))).toLocaleString("en-US")} stated` }
        : { state: "BELOW", text: `Stated maximum $${Math.max(...cov.map((c) => Number(c.maxLimit))).toLocaleString("en-US")} is below $${f.limit.toLocaleString("en-US")}` };
      const orgsForContacts = [cp.writingCompanyId, ...(ch?.intermediaryOrgId ? [ch.intermediaryOrgId] : [])];
      results.push({
        key: `${cp.id}:${ch?.id ?? "none"}`,
        group: missing.length ? "NEEDS_INFO" : outcome,
        outcome,
        missing,
        carrierProductId: cp.id,
        channelId: ch?.id ?? null,
        carrier: cp.writingCompany,
        product: cp.product.name,
        channel: ch ? (ch.intermediary ? `via ${ch.intermediary.displayName}` : "Direct") : "No channel recorded",
        profileId: profile?.id ?? null,
        version: profile?.version ?? null,
        stale: !!profile?.nextReviewAt && profile.nextReviewAt <= new Date(),
        nextReviewAt: profile?.nextReviewAt ?? null,
        sources: profile ? (sourceCount.get(profile.id) ?? 0) : 0,
        matchedRules: applying.map((e) => ({ id: e.id, outcome: e.outcome, scope: scopeText(e.rule, territoryById) + (e.rule.attributeDefinition ? ` · ${conditionText(e.rule)}` : ""), rationale: e.rule.rationale })),
        conditions,
        conflicting: new Set(applying.map((r) => r.outcome)).size > 1,
        limit,
        contacts: contacts
          .filter((a) => orgsForContacts.includes(a.organizationId))
          .slice(0, 3)
          .map((a) => ({ id: a.contact.id, name: `${a.contact.firstName} ${a.contact.lastName}`, role: a.role, email: a.contact.email, phone: a.contact.officePhone })),
        note: !profile ? "No approved appetite recorded" : rules.length === 0 ? "Appetite recorded, but nothing stated for this class/state" : null,
      });
    }
  }

  const rank = (r: Result) => [GROUP_ORDER.indexOf(r.group), OUTCOME_ORDER.indexOf(r.outcome), r.limit.state === "BELOW" ? 1 : 0, r.stale ? 1 : 0];
  results.sort((a, b) => {
    const x = rank(a), y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return a.carrier.displayName.localeCompare(b.carrier.displayName);
  });
  const groups = GROUP_ORDER.map((outcome) => ({ outcome, results: results.filter((r) => r.group === outcome) }));
  return {
    disclaimer,
    filters: { ...f, industry: wanted ? `${wanted.classificationSystem} ${wanted.code}` : null },
    attributes,
    risk: Object.fromEntries(risk),
    industry: resolved ? { classificationSystem: resolved.classificationSystem, code: resolved.code, title: resolved.title, matchedWords: resolved.matchedWords } : null,
    industryChoices: [] as IndustryChoice[],
    total: results.length,
    groups,
  };
}

const OUTCOME_ORDER: AppetiteOutcome[] = ["PREFERRED", "ACCEPTED", "REFERRAL", "PROHIBITED", "UNKNOWN"];

function evaluationFor(r: Rule, risk: Map<string, string>): Evaluation | null {
  if (!r.attributeDefinition || !r.operator) return null;
  return evaluateCondition(r.attributeDefinition.dataType as DataType, r.operator as Operator, r.typedValue as Parameters<typeof evaluateCondition>[2], risk.get(r.attributeDefinition.key) ?? null);
}

function scopeText(r: Rule, territoryById: Map<string, { stateCode: string | null; name: string }>): string {
  const states = r.territories.length ? r.territories.map((t) => territoryById.get(t.territoryId)?.stateCode ?? territoryById.get(t.territoryId)?.name ?? "?").join(", ") : "all states";
  const ind = r.industries.length ? r.industries.map((i) => `${i.classificationSystem} ${i.code}`).join(", ") : "all classes";
  return `${ind} · ${states}`;
}

function conditionText(r: Rule): string {
  const v = (r.typedValue ?? {}) as { value?: string; min?: string; max?: string; values?: string[] };
  const op: Record<string, string> = { EQ: "=", NEQ: "≠", LT: "<", LTE: "≤", GT: ">", GTE: "≥", BETWEEN: "between", IN: "one of", NOT_IN: "not one of", EXISTS: "present" };
  const val = v.values ? v.values.join(", ") : v.min !== undefined ? `${v.min} and ${v.max}` : (v.value ?? "");
  return `${r.attributeDefinition!.label} ${op[r.operator!]} ${val}${r.attributeDefinition!.unit ? ` ${r.attributeDefinition!.unit}` : ""}`.trim();
}
