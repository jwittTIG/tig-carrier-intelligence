import { z } from "zod";
import type { RecordType } from "@/generated/prisma/enums";
import type { PermissionCode } from "@/server/auth/catalog";
import { assertCan, can, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError } from "@/server/errors";
import { optionalText, parse } from "@/server/validation";
import { applyProfileDecision } from "./appetite";
import { checkReviewer, closeChangeRequest } from "./approvals-core";
import { applyAgreementDecision, applyScheduleDecision } from "./commissions";
import { staleInboxCount } from "./inbox";
import { numberSetting, SETTING } from "./settings";

/** Approvals queue and decisions (PRD screen 9, P0-09, DECISIONS D14). */

const APPROVE_PERMISSION: Partial<Record<RecordType, PermissionCode>> = {
  APPETITE_PROFILE: "appetite.approve",
  COMMISSION_AGREEMENT: "commission.approve",
  COMMISSION_SCHEDULE: "commission.approve",
};

const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), rationale: optionalText(2000) });

export async function decide(ctx: AuthContext, changeRequestId: string, input: unknown) {
  assertCan(ctx, "change_request.review");
  const { decision, rationale } = parse(decisionSchema, input);
  return prisma.$transaction(async (tx) => {
    if (!z.uuid().safeParse(changeRequestId).success) throw new NotFoundError("Request not found.");
    const cr = await tx.changeRequest.findUnique({ where: { id: changeRequestId } });
    if (!cr) throw new NotFoundError("Request not found.");
    if (cr.status !== "PENDING" || !cr.recordId) throw new ConflictError("This request has already been decided.");
    const permission = APPROVE_PERMISSION[cr.recordType];
    if (!permission) throw new ConflictError("This kind of request can't be decided here.");
    assertCan(ctx, permission);
    const reason = checkReviewer(ctx, cr, decision, rationale);
    if (cr.recordType === "APPETITE_PROFILE") await applyProfileDecision(tx, ctx, cr.recordId, decision);
    else if (cr.recordType === "COMMISSION_AGREEMENT") await applyAgreementDecision(tx, ctx, cr.recordId, decision);
    else await applyScheduleDecision(tx, ctx, cr.recordId, decision);
    return closeChangeRequest(tx, ctx, cr.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", reason);
  });
}

/** Where a change request's record lives in the app. */
async function linkFor(recordType: RecordType, recordId: string): Promise<{ href: string; label: string } | null> {
  if (recordType === "APPETITE_PROFILE") {
    const p = await prisma.appetiteProfile.findUnique({ where: { id: recordId }, include: { carrierProduct: { include: { writingCompany: true, product: true } } } });
    return p && { href: `/appetite/${p.id}`, label: `Appetite: ${p.carrierProduct.writingCompany.displayName} · ${p.carrierProduct.product.name} v${p.version}` };
  }
  if (recordType === "COMMISSION_AGREEMENT") {
    const a = await prisma.commissionAgreement.findUnique({ where: { id: recordId }, include: { marketChannel: { include: { carrierProduct: { include: { writingCompany: true } } } } } });
    return a && { href: `/commissions/${a.id}`, label: `Commission agreement: ${a.marketChannel.carrierProduct.writingCompany.displayName}${a.agreementRef ? ` (${a.agreementRef})` : ""}` };
  }
  if (recordType === "COMMISSION_SCHEDULE") {
    const s = await prisma.commissionSchedule.findUnique({ where: { id: recordId }, include: { product: true, agreement: { include: { marketChannel: { include: { carrierProduct: { include: { writingCompany: true } } } } } } } });
    return s && { href: `/commissions/${s.agreementId}#schedule-${s.id}`, label: `Commission schedule: ${s.agreement.marketChannel.carrierProduct.writingCompany.displayName} · ${s.product.name} · ${s.transactionType.toLowerCase()}` };
  }
  return null;
}

export async function listQueue(ctx: AuthContext) {
  assertCan(ctx, "change_request.review");
  const pending = await prisma.changeRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { proposedBy: { select: { id: true, name: true } } } });
  const items = [];
  for (const cr of pending) {
    const permission = APPROVE_PERMISSION[cr.recordType];
    items.push({
      ...cr,
      link: cr.recordId ? await linkFor(cr.recordType, cr.recordId) : null,
      canDecide: !!permission && can(ctx, permission),
      isOwn: cr.proposedById === ctx.userId,
    });
  }
  const recent = await prisma.changeRequest.findMany({
    where: { status: { in: ["APPROVED", "REJECTED", "WITHDRAWN"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { proposedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } },
  });
  return { pending: items, recent };
}

/** Records due for review, and organizations that may be duplicates. */
export async function dataQuality(ctx: AuthContext) {
  assertCan(ctx, "carrier.read");
  const now = new Date();
  const contactDays = await numberSetting(SETTING.contactReviewDays);
  const staleAppetite = can(ctx, "appetite.read")
    ? await prisma.appetiteProfile.findMany({
        where: { status: "APPROVED", nextReviewAt: { lte: now } },
        orderBy: { nextReviewAt: "asc" },
        take: 100,
        include: { carrierProduct: { include: { writingCompany: { select: { displayName: true } }, product: { select: { name: true } } } } },
      })
    : [];
  const staleContacts = can(ctx, "contact.read")
    ? await prisma.contact.count({ where: { archivedAt: null, status: "ACTIVE", OR: [{ verifiedAt: null }, { verifiedAt: { lte: new Date(now.getTime() - contactDays * 86_400_000) } }] } })
    : 0;
  const duplicates = await prisma.$queryRaw<{ a_id: string; a_name: string; b_id: string; b_name: string; score: number }[]>`
    select a.id as a_id, a.display_name as a_name, b.id as b_id, b.display_name as b_name, similarity(a.display_name, b.display_name)::float8 as score
    from organizations a join organizations b on a.id < b.id
    where a.type <> 'AGENCY' and b.type <> 'AGENCY' and a.archived_at is null and b.archived_at is null
      and similarity(a.display_name, b.display_name) > 0.6
    order by score desc limit 50`;
  const staleInbox = await staleInboxCount(ctx);
  const inboxDays = await numberSetting("inbox.stale_days");
  return { staleAppetite, staleContacts, contactDays, duplicates, staleInbox, inboxDays };
}
