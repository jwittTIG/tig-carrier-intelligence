import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { CommissionBasis, TransactionType } from "@/generated/prisma/enums";
import { addDays, todayUtc } from "@/lib/dates";
import { recordAudit } from "@/server/audit";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { optionalDate, optionalId, optionalText, parse } from "@/server/validation";
import { closeChangeRequest, openChangeRequest, pendingRequestFor } from "./approvals-core";
import { hasSource } from "./sources";

/**
 * Commission agreements and schedules (PRD screen 7, P0-06). Every read needs
 * commission.read. Schedules are effective-dated and immutable once approved: a rate change is
 * a new schedule. Approving it ends the schedule it replaces the day before. Overlapping
 * approved schedules with the same scope are refused by the database.
 * Rates are stored as fractions (0.125 = 12.5%) using Decimal, never floats.
 */

type Tx = Prisma.TransactionClient;
const decimal = /^\d+(\.\d+)?$/;

/** "12.5" or "12.5%" → Decimal 0.125. Exact decimal arithmetic. */
export function percentToFraction(input: string): Prisma.Decimal {
  const s = input.trim().replace(/%$/, "").trim();
  if (!decimal.test(s)) throw new ValidationError(`"${input}" isn't a percentage.`);
  const d = new Prisma.Decimal(s);
  if (d.gt(100)) throw new ValidationError("A rate can't be more than 100%.");
  const f = d.div(100);
  if (f.decimalPlaces() > 6) throw new ValidationError("Rates can have at most 4 decimal places (e.g. 12.3456%).");
  return f;
}

export function fractionToPercent(d: Prisma.Decimal | null | undefined): string {
  if (!d) return "";
  return `${d.mul(100).toFixed(4).replace(/\.?0+$/, "")}%`;
}

const amount = (label: string) =>
  z.preprocess((v) => (typeof v === "string" ? v.replace(/[$,\s]/g, "") : v), z.union([z.literal(""), z.string().regex(decimal, `${label} must be an amount`)]).optional())
    .transform((v) => (v ? new Prisma.Decimal(v) : null));
const percent = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()).transform((v) => (v ? percentToFraction(v) : null));

async function findAgreement(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Agreement not found.");
  const a = await tx.commissionAgreement.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Agreement not found.");
  return a;
}

async function findSchedule(tx: Tx, agreementId: string, scheduleId: string) {
  const s = await tx.commissionSchedule.findFirst({ where: { id: scheduleId, agreementId } });
  if (!s) throw new NotFoundError("Schedule not found on this agreement.");
  return s;
}

const channelInclude = {
  carrierProduct: { include: { writingCompany: { select: { id: true, displayName: true } }, product: { select: { name: true } } } },
  intermediary: { select: { id: true, displayName: true } },
} satisfies Prisma.MarketChannelInclude;

// ───────────────────────────── Reads ─────────────────────────────

export async function listAgreementsForCarrier(ctx: AuthContext, orgId: string) {
  assertCan(ctx, "commission.read");
  const today = todayUtc();
  const rows = await prisma.commissionAgreement.findMany({
    where: { marketChannel: { OR: [{ intermediaryOrgId: orgId }, { carrierProduct: { writingCompanyId: orgId } }] } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      agencyEntity: { include: { organization: { select: { displayName: true } } } },
      marketChannel: { include: channelInclude },
      schedules: {
        where: { status: "APPROVED", effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
        include: { product: { select: { name: true } }, territory: { select: { name: true } } },
        orderBy: [{ productId: "asc" }, { transactionType: "asc" }],
      },
    },
  });
  return rows.map((a) => ({ ...a, currentSchedules: a.schedules, schedules: undefined }));
}

export async function getAgreement(ctx: AuthContext, id: string) {
  assertCan(ctx, "commission.read");
  await findAgreement(prisma, id);
  const a = await prisma.commissionAgreement.findUniqueOrThrow({
    where: { id },
    include: {
      agencyEntity: { include: { organization: { select: { displayName: true } } } },
      marketChannel: { include: channelInclude },
      approvedBy: { select: { name: true } },
      sourceDocumentVersion: { select: { id: true, versionNumber: true, document: { select: { id: true, title: true } } } },
      schedules: {
        orderBy: [{ productId: "asc" }, { territoryId: "asc" }, { transactionType: "asc" }, { effectiveFrom: "desc" }],
        include: { product: { select: { id: true, name: true } }, territory: { select: { id: true, name: true } }, tiers: { orderBy: { thresholdMin: "asc" } }, approvedBy: { select: { name: true } } },
      },
    },
  });
  const pending = await prisma.changeRequest.findMany({
    where: { status: "PENDING", OR: [{ recordType: "COMMISSION_AGREEMENT", recordId: id }, { recordType: "COMMISSION_SCHEDULE", recordId: { in: a.schedules.map((s) => s.id) } }] },
    include: { proposedBy: { select: { name: true } } },
  });
  const today = todayUtc();
  return {
    ...a,
    pending,
    schedules: a.schedules.map((s) => ({
      ...s,
      current: s.status === "APPROVED" && s.effectiveFrom <= today && (!s.effectiveTo || s.effectiveTo >= today),
      pending: pending.find((p) => p.recordType === "COMMISSION_SCHEDULE" && p.recordId === s.id) ?? null,
    })),
  };
}

// ───────────────────────────── Agreements ─────────────────────────────

const agreementSchema = z.object({
  agencyEntityId: z.uuid(),
  marketChannelId: z.uuid(),
  agreementRef: optionalText(120),
  sourceDocumentVersionId: optionalId,
  contingencyNotes: optionalText(5000),
  notes: optionalText(5000),
});

export async function createAgreement(ctx: AuthContext, input: unknown) {
  assertCan(ctx, "commission.write");
  const data = parse(agreementSchema, input);
  return prisma.$transaction(async (tx) => {
    if (!(await tx.agencyEntity.findUnique({ where: { id: data.agencyEntityId } }))) throw new ValidationError("Agency entity not found.");
    if (!(await tx.marketChannel.findUnique({ where: { id: data.marketChannelId } }))) throw new ValidationError("Channel not found.");
    if (data.sourceDocumentVersionId && !(await tx.documentVersion.findUnique({ where: { id: data.sourceDocumentVersionId } }))) throw new ValidationError("Document not found.");
    const row = await tx.commissionAgreement.create({
      data: {
        agencyEntityId: data.agencyEntityId,
        marketChannelId: data.marketChannelId,
        agreementRef: data.agreementRef ?? null,
        sourceDocumentVersionId: data.sourceDocumentVersionId ?? null,
        contingencyNotes: data.contingencyNotes ?? null,
        notes: data.notes ?? null,
      },
    });
    await recordAudit(tx, ctx, { action: "commission.agreement.create", entityType: "commission_agreement", entityId: row.id, after: row });
    return row;
  });
}

const agreementUpdate = z.object({ agreementRef: optionalText(120), sourceDocumentVersionId: optionalId, contingencyNotes: optionalText(5000), notes: optionalText(5000) });

/**
 * Notes and contingency/profit-sharing notes can change at any time (audited). The reference
 * and source document are locked once approved.
 */
export async function updateAgreement(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "commission.write");
  const data = parse(agreementUpdate, input);
  const raw = (input ?? {}) as Record<string, unknown>;
  return prisma.$transaction(async (tx) => {
    const before = await findAgreement(tx, id);
    const patch: Prisma.CommissionAgreementUncheckedUpdateInput = {};
    if ("contingencyNotes" in raw) patch.contingencyNotes = data.contingencyNotes ?? null;
    if ("notes" in raw) patch.notes = data.notes ?? null;
    const locked = before.status !== "DRAFT";
    if ("agreementRef" in raw && (data.agreementRef ?? null) !== before.agreementRef) {
      if (locked) throw new ConflictError("The agreement reference can't change after submission.");
      patch.agreementRef = data.agreementRef ?? null;
    }
    if ("sourceDocumentVersionId" in raw && (data.sourceDocumentVersionId ?? null) !== before.sourceDocumentVersionId) {
      if (locked) throw new ConflictError("The source document can't change after submission.");
      if (data.sourceDocumentVersionId && !(await tx.documentVersion.findUnique({ where: { id: data.sourceDocumentVersionId } }))) throw new ValidationError("Document not found.");
      patch.sourceDocumentVersionId = data.sourceDocumentVersionId ?? null;
    }
    const after = await tx.commissionAgreement.update({ where: { id }, data: patch });
    await recordAudit(tx, ctx, { action: "commission.agreement.update", entityType: "commission_agreement", entityId: id, before, after });
    return after;
  });
}

export async function submitAgreement(ctx: AuthContext, id: string, input: unknown) {
  assertCan(ctx, "commission.write");
  const { note } = parse(z.object({ note: optionalText(1000) }), input);
  return prisma.$transaction(async (tx) => {
    const a = await findAgreement(tx, id);
    if (a.status !== "DRAFT") throw new ConflictError("Only draft agreements can be submitted.");
    if (!a.sourceDocumentVersionId) throw new ValidationError("Attach the signed agreement (a document) before submitting.");
    const after = await tx.commissionAgreement.update({ where: { id }, data: { status: "PENDING" } });
    await openChangeRequest(tx, ctx, { recordType: "COMMISSION_AGREEMENT", recordId: id, proposed: { action: "approve", agreementRef: a.agreementRef }, note });
    await recordAudit(tx, ctx, { action: "commission.agreement.submit", entityType: "commission_agreement", entityId: id, before: a, after });
    return after;
  });
}

export async function applyAgreementDecision(tx: Tx, ctx: AuthContext, id: string, decision: "APPROVE" | "REJECT") {
  const a = await findAgreement(tx, id);
  if (a.status !== "PENDING") throw new ConflictError("This agreement isn't waiting for approval.");
  const after = await tx.commissionAgreement.update({
    where: { id },
    data: decision === "APPROVE" ? { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } : { status: "DRAFT" },
  });
  await recordAudit(tx, ctx, { action: `commission.agreement.${decision === "APPROVE" ? "approve" : "reject"}`, entityType: "commission_agreement", entityId: id, before: a, after });
}

// ───────────────────────────── Schedules ─────────────────────────────

const scheduleSchema = z
  .object({
    productId: z.uuid(),
    territoryId: optionalId,
    transactionType: z.enum(TransactionType),
    basis: z.enum(CommissionBasis),
    ratePercent: percent,
    flatAmount: amount("Flat amount"),
    effectiveFrom: z.preprocess((v) => (v === "" ? undefined : v), z.iso.date({ error: "Effective date is required" }).transform((s) => new Date(`${s}T00:00:00.000Z`))),
    effectiveTo: optionalDate,
    notes: optionalText(2000),
  })
  .refine((s) => !s.effectiveTo || s.effectiveTo >= s.effectiveFrom, { message: "End date must be on or after the start date", path: ["effectiveTo"] })
  .refine((s) => s.basis !== "RATE" || !!s.ratePercent, { message: "Enter the rate", path: ["ratePercent"] })
  .refine((s) => s.basis !== "FLAT" || !!s.flatAmount, { message: "Enter the flat amount", path: ["flatAmount"] });

export async function addSchedule(ctx: AuthContext, agreementId: string, input: unknown) {
  assertCan(ctx, "commission.write");
  const data = parse(scheduleSchema, input);
  return prisma.$transaction(async (tx) => {
    const agreement = await findAgreement(tx, agreementId);
    if (agreement.status === "RETIRED") throw new ConflictError("This agreement is retired.");
    if (!(await tx.insuranceProduct.findUnique({ where: { id: data.productId } }))) throw new ValidationError("Product not found.");
    if (data.territoryId && !(await tx.territory.findUnique({ where: { id: data.territoryId } }))) throw new ValidationError("Territory not found.");
    const row = await tx.commissionSchedule.create({
      data: {
        agreementId,
        productId: data.productId,
        territoryId: data.territoryId ?? null,
        transactionType: data.transactionType,
        basis: data.basis,
        rate: data.basis === "RATE" ? data.ratePercent : null,
        flatAmount: data.basis === "FLAT" ? data.flatAmount : null,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo ?? null,
        notes: data.notes ?? null,
      },
    });
    await recordAudit(tx, ctx, { action: "commission.schedule.create", entityType: "commission_schedule", entityId: row.id, after: row });
    return row;
  });
}

export async function deleteDraftSchedule(ctx: AuthContext, agreementId: string, scheduleId: string) {
  assertCan(ctx, "commission.write");
  return prisma.$transaction(async (tx) => {
    const s = await findSchedule(tx, agreementId, scheduleId);
    if (s.status !== "DRAFT") throw new ConflictError("Only draft schedules can be deleted.");
    if (await tx.changeRequest.count({ where: { recordType: "COMMISSION_SCHEDULE", recordId: s.id } })) throw new ConflictError("This schedule has review history, so it can't be deleted.");
    await tx.commissionSchedule.delete({ where: { id: s.id } });
    await recordAudit(tx, ctx, { action: "commission.schedule.delete_draft", entityType: "commission_schedule", entityId: s.id, before: s });
  });
}

const tierSchema = z
  .object({ thresholdMin: amount("From"), thresholdMax: amount("To"), ratePercent: percent, flatAmount: amount("Flat amount") })
  .refine((t) => !!t.thresholdMin, { message: "Enter where the tier starts", path: ["thresholdMin"] })
  .refine((t) => !!t.ratePercent || !!t.flatAmount, { message: "Enter a rate or a flat amount", path: ["ratePercent"] })
  .refine((t) => !t.thresholdMin || !t.thresholdMax || t.thresholdMax.gte(t.thresholdMin), { message: "The tier's end must be at least its start", path: ["thresholdMax"] });

export async function addTier(ctx: AuthContext, agreementId: string, scheduleId: string, input: unknown) {
  assertCan(ctx, "commission.write");
  const data = parse(tierSchema, input);
  return prisma.$transaction(async (tx) => {
    const s = await findSchedule(tx, agreementId, scheduleId);
    if (s.status !== "DRAFT") throw new ConflictError("Only draft schedules can change.");
    if (s.basis !== "TIERED") throw new ValidationError("Tiers only apply to tiered schedules.");
    const row = await tx.commissionTier.create({ data: { scheduleId, thresholdMin: data.thresholdMin!, thresholdMax: data.thresholdMax, rate: data.ratePercent, flatAmount: data.flatAmount } });
    await recordAudit(tx, ctx, { action: "commission.tier.add", entityType: "commission_tier", entityId: row.id, after: { ...row, scheduleId } });
    return row;
  });
}

/** Same agreement, product, territory (null = all), transaction type and basis. */
const sameScope = (s: { agreementId: string; productId: string; territoryId: string | null; transactionType: TransactionType; basis: CommissionBasis }) => ({
  agreementId: s.agreementId,
  productId: s.productId,
  territoryId: s.territoryId,
  transactionType: s.transactionType,
  basis: s.basis,
});

export async function submitSchedule(ctx: AuthContext, agreementId: string, scheduleId: string, input: unknown) {
  assertCan(ctx, "commission.write");
  const { note } = parse(z.object({ note: optionalText(1000) }), input);
  return prisma.$transaction(async (tx) => {
    const s = await findSchedule(tx, agreementId, scheduleId);
    if (s.status !== "DRAFT") throw new ConflictError("Only draft schedules can be submitted.");
    if (s.basis === "TIERED" && (await tx.commissionTier.count({ where: { scheduleId } })) === 0) throw new ValidationError("Add at least one tier before submitting.");
    const agreement = await findAgreement(tx, agreementId);
    const sourced = !!agreement.sourceDocumentVersionId || (await hasSource(tx, "COMMISSION_SCHEDULE", scheduleId));
    if (!sourced) throw new ValidationError("Attach the agreement document, or add a source for this schedule, before submitting.");
    const replaces = await tx.commissionSchedule.findFirst({
      where: { ...sameScope(s), status: "APPROVED", effectiveFrom: { lt: s.effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: s.effectiveFrom } }] },
    });
    const after = await tx.commissionSchedule.update({ where: { id: scheduleId }, data: { status: "PENDING" } });
    await openChangeRequest(tx, ctx, {
      recordType: "COMMISSION_SCHEDULE",
      recordId: scheduleId,
      proposed: {
        action: "approve",
        rate: fractionToPercent(s.rate),
        flatAmount: s.flatAmount?.toString() ?? null,
        effectiveFrom: s.effectiveFrom,
        replaces: replaces ? { id: replaces.id, rate: fractionToPercent(replaces.rate), endsOn: addDays(s.effectiveFrom, -1) } : null,
      },
      note,
    });
    await recordAudit(tx, ctx, { action: "commission.schedule.submit", entityType: "commission_schedule", entityId: scheduleId, before: s, after });
    return after;
  });
}

function isExclusionViolation(e: unknown): boolean {
  const s = JSON.stringify(e, Object.getOwnPropertyNames(e as object)) ?? "";
  return s.includes("23P01") || s.includes("commission_schedules_no_overlap_excl");
}

/**
 * Approves a schedule: needs an approved agreement; ends the approved schedule it replaces
 * (same scope, started earlier) the day before; refuses overlaps with anything else.
 */
export async function applyScheduleDecision(tx: Tx, ctx: AuthContext, id: string, decision: "APPROVE" | "REJECT") {
  const s = await tx.commissionSchedule.findUnique({ where: { id } });
  if (!s) throw new NotFoundError("Schedule not found.");
  if (s.status !== "PENDING") throw new ConflictError("This schedule isn't waiting for approval.");
  if (decision === "REJECT") {
    const after = await tx.commissionSchedule.update({ where: { id }, data: { status: "DRAFT" } });
    await recordAudit(tx, ctx, { action: "commission.schedule.reject", entityType: "commission_schedule", entityId: id, before: s, after });
    return;
  }
  const agreement = await findAgreement(tx, s.agreementId);
  if (agreement.status !== "APPROVED") throw new ConflictError("Approve the agreement first.");
  const replaced = await tx.commissionSchedule.findMany({
    where: { ...sameScope(s), status: "APPROVED", effectiveFrom: { lt: s.effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: s.effectiveFrom } }] },
  });
  for (const old of replaced) {
    const after = await tx.commissionSchedule.update({ where: { id: old.id }, data: { effectiveTo: addDays(s.effectiveFrom, -1) } });
    await recordAudit(tx, ctx, { action: "commission.schedule.superseded", entityType: "commission_schedule", entityId: old.id, before: old, after: { ...after, replacedBy: id } });
  }
  try {
    const after = await tx.commissionSchedule.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } });
    await recordAudit(tx, ctx, { action: "commission.schedule.approve", entityType: "commission_schedule", entityId: id, before: s, after });
  } catch (e) {
    // Any overlap rolls back the whole decision, including the supersede step above.
    if (isExclusionViolation(e)) {
      throw new ConflictError("This schedule overlaps another approved schedule with the same product, territory, transaction type and basis that starts on or after it. Change its dates, or retire the other schedule first.");
    }
    throw e;
  }
}

export async function withdrawSubmission(ctx: AuthContext, recordType: "COMMISSION_AGREEMENT" | "COMMISSION_SCHEDULE", id: string) {
  assertCan(ctx, "commission.write");
  return prisma.$transaction(async (tx) => {
    const cr = await pendingRequestFor(tx, recordType, id);
    if (!cr) throw new ConflictError("This isn't waiting for approval.");
    if (cr.proposedById !== ctx.userId) throw new ConflictError("Only the person who submitted it can withdraw it.");
    await closeChangeRequest(tx, ctx, cr.id, "WITHDRAWN", null);
    if (recordType === "COMMISSION_AGREEMENT") await tx.commissionAgreement.update({ where: { id }, data: { status: "DRAFT" } });
    else await tx.commissionSchedule.update({ where: { id }, data: { status: "DRAFT" } });
    await recordAudit(tx, ctx, { action: "commission.withdraw", entityType: recordType.toLowerCase(), entityId: id, after: { status: "DRAFT" } });
  });
}

/** Retire an approved schedule (no longer offered). Needs commission.approve and a reason. */
export async function retireSchedule(ctx: AuthContext, agreementId: string, scheduleId: string, input: unknown) {
  assertCan(ctx, "commission.approve");
  const { reason, effectiveTo } = parse(z.object({ reason: z.string().trim().min(5, "Give a reason"), effectiveTo: optionalDate }), input);
  return prisma.$transaction(async (tx) => {
    const s = await findSchedule(tx, agreementId, scheduleId);
    if (s.status !== "APPROVED") throw new ConflictError("Only approved schedules can be retired.");
    const end = effectiveTo ?? s.effectiveTo ?? todayUtc();
    if (end < s.effectiveFrom) throw new ValidationError("End date must be on or after the start date.");
    const after = await tx.commissionSchedule.update({ where: { id: s.id }, data: { status: "RETIRED", effectiveTo: end } });
    await recordAudit(tx, ctx, { action: "commission.schedule.retire", entityType: "commission_schedule", entityId: s.id, before: s, after: { ...after, reason } });
  });
}

/** CSV of all schedules on an agreement (or every agreement). Formula-leading cells neutralized. */
export async function schedulesCsv(ctx: AuthContext, agreementId?: string) {
  assertCan(ctx, "commission.read");
  const rows = await prisma.commissionSchedule.findMany({
    where: agreementId ? { agreementId } : {},
    orderBy: [{ agreementId: "asc" }, { productId: "asc" }, { transactionType: "asc" }, { effectiveFrom: "asc" }],
    include: {
      product: { select: { name: true } },
      territory: { select: { name: true } },
      tiers: { orderBy: { thresholdMin: "asc" } },
      agreement: { include: { agencyEntity: { include: { organization: { select: { displayName: true } } } }, marketChannel: { include: channelInclude } } },
    },
  });
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ["Carrier", "Channel", "Agency entity", "Agreement", "Product", "Territory", "Transaction", "Basis", "Rate", "Flat amount", "Tiers", "Status", "Effective from", "Effective to", "Notes"];
  const lines = rows.map((s) => {
    const ch = s.agreement.marketChannel;
    const tiers = s.tiers.map((t) => `${t.thresholdMin}-${t.thresholdMax ?? "+"}: ${t.rate ? fractionToPercent(t.rate) : t.flatAmount}`).join("; ");
    return [
      ch.carrierProduct.writingCompany.displayName, ch.intermediary ? `via ${ch.intermediary.displayName}` : "Direct", s.agreement.agencyEntity.organization.displayName,
      s.agreement.agreementRef, s.product.name, s.territory?.name ?? "All", s.transactionType, s.basis, fractionToPercent(s.rate), s.flatAmount?.toString(), tiers,
      s.status, s.effectiveFrom, s.effectiveTo, s.notes,
    ].map(cell).join(",");
  });
  return [header.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}
