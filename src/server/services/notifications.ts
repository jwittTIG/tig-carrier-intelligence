import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { NotificationType, RecordType } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";

/**
 * In-app notifications (M7, DECISIONS D23). Staff follow carriers; events on those carriers
 * notify followers. Nobody is notified about their own action. Each user sees only their
 * own notifications. Reminders carry a dedupe key so each record and date is sent once.
 * No email or Teams delivery.
 */

type Tx = Prisma.TransactionClient;
type Note = { eventType: NotificationType; title: string; body?: string | null; href?: string | null; organizationId?: string | null; payload?: Prisma.InputJsonValue; dedupeKey?: string | null };

/** Active users, minus the actor. */
async function activeRecipients(tx: Tx, userIds: string[], actorId: string | null): Promise<string[]> {
  const ids = [...new Set(userIds)].filter((id) => id !== actorId);
  if (!ids.length) return [];
  const users = await tx.user.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true } });
  return users.map((u) => u.id);
}

async function send(tx: Tx, recipients: string[], actorId: string | null, n: Note): Promise<number> {
  const to = await activeRecipients(tx, recipients, actorId);
  if (!to.length) return 0;
  const r = await tx.notification.createMany({
    data: to.map((recipientUserId) => ({
      recipientUserId,
      actorUserId: actorId,
      eventType: n.eventType,
      title: n.title.slice(0, 300),
      body: n.body?.slice(0, 2000) ?? null,
      href: n.href ?? null,
      organizationId: n.organizationId ?? null,
      payload: n.payload ?? {},
      dedupeKey: n.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });
  return r.count;
}

async function followersOf(tx: Tx, orgIds: string[]): Promise<string[]> {
  if (!orgIds.length) return [];
  const f = await tx.carrierFollow.findMany({ where: { organizationId: { in: orgIds } }, select: { userId: true } });
  return f.map((x) => x.userId);
}

type Subject = { orgIds: string[]; organizationId: string; label: string; href: string };

/** The carrier(s) a change request's record belongs to, with a link and a readable name. */
export async function subjectOf(tx: Tx, recordType: RecordType, recordId: string): Promise<Subject | null> {
  const channelOrgs = (ch: { intermediaryOrgId: string | null } | null) => (ch?.intermediaryOrgId ? [ch.intermediaryOrgId] : []);
  if (recordType === "APPETITE_PROFILE") {
    const p = await tx.appetiteProfile.findUnique({ where: { id: recordId }, include: { marketChannel: true, carrierProduct: { include: { writingCompany: true, product: true } } } });
    if (!p) return null;
    const wc = p.carrierProduct.writingCompany;
    return { orgIds: [wc.id, ...channelOrgs(p.marketChannel)], organizationId: wc.id, label: `appetite for ${wc.displayName} · ${p.carrierProduct.product.name} (v${p.version})`, href: `/appetite/${p.id}` };
  }
  if (recordType === "COMMISSION_AGREEMENT") {
    const a = await tx.commissionAgreement.findUnique({ where: { id: recordId }, include: { marketChannel: { include: { carrierProduct: { include: { writingCompany: true } } } } } });
    if (!a) return null;
    const wc = a.marketChannel.carrierProduct.writingCompany;
    return { orgIds: [wc.id, ...channelOrgs(a.marketChannel)], organizationId: wc.id, label: `the commission agreement with ${wc.displayName}${a.agreementRef ? ` (${a.agreementRef})` : ""}`, href: `/commissions/${a.id}` };
  }
  if (recordType === "COMMISSION_SCHEDULE") {
    const s = await tx.commissionSchedule.findUnique({ where: { id: recordId }, include: { product: true, agreement: { include: { marketChannel: { include: { carrierProduct: { include: { writingCompany: true } } } } } } } });
    if (!s) return null;
    const ch = s.agreement.marketChannel;
    const wc = ch.carrierProduct.writingCompany;
    return { orgIds: [wc.id, ...channelOrgs(ch)], organizationId: wc.id, label: `a commission schedule for ${wc.displayName} · ${s.product.name} (${s.transactionType.toLowerCase()})`, href: `/commissions/${s.agreementId}#schedule-${s.id}` };
  }
  return null;
}

/** Called in the same transaction that opens a change request. */
export async function onChangeRequestOpened(tx: Tx, ctx: AuthContext, cr: { id: string; recordType: RecordType; recordId: string | null }) {
  if (!cr.recordId) return;
  const subject = await subjectOf(tx, cr.recordType, cr.recordId);
  if (!subject) return;
  await send(tx, await followersOf(tx, subject.orgIds), ctx.userId, {
    eventType: "CHANGE_REQUEST_SUBMITTED",
    title: `${ctx.name} submitted ${subject.label} for approval`,
    href: subject.href,
    organizationId: subject.organizationId,
    payload: { changeRequestId: cr.id, recordType: cr.recordType, recordId: cr.recordId },
  });
}

/** Called in the same transaction that approves or rejects a change request. */
export async function onChangeRequestClosed(tx: Tx, ctx: AuthContext, cr: { id: string; recordType: RecordType; recordId: string | null; status: string; proposedById: string; rationale: string | null }) {
  if (!cr.recordId || (cr.status !== "APPROVED" && cr.status !== "REJECTED")) return;
  const subject = await subjectOf(tx, cr.recordType, cr.recordId);
  if (!subject) return;
  const approved = cr.status === "APPROVED";
  const payload = { changeRequestId: cr.id, recordType: cr.recordType, recordId: cr.recordId };
  await send(tx, [cr.proposedById], ctx.userId, {
    eventType: approved ? "CHANGE_REQUEST_APPROVED" : "CHANGE_REQUEST_REJECTED",
    title: `${ctx.name} ${approved ? "approved" : "rejected"} your submission: ${subject.label}`,
    body: cr.rationale,
    href: subject.href,
    organizationId: subject.organizationId,
    payload,
  });
  if (approved) {
    // The submitter already got the message above.
    const followers = (await followersOf(tx, subject.orgIds)).filter((u) => u !== cr.proposedById);
    await send(tx, followers, ctx.userId, {
      eventType: "RECORD_APPROVED",
      title: `Approved: ${subject.label}`,
      href: subject.href,
      organizationId: subject.organizationId,
      payload,
    });
  }
}

/** Called in the same transaction that files an inbox email under a carrier. */
export async function onInboxFiled(tx: Tx, ctx: AuthContext, m: { id: string; subject: string }, org: { id: string; displayName: string }) {
  await send(tx, await followersOf(tx, [org.id]), ctx.userId, {
    eventType: "INBOX_FILED",
    title: `New update filed under ${org.displayName}: ${m.subject}`,
    href: `/inbox/${m.id}`,
    organizationId: org.id,
    payload: { inboundMessageId: m.id },
  });
}

// ───────────────────────────── Reading your own ─────────────────────────────

export async function listNotifications(ctx: AuthContext, opts: { unreadOnly?: boolean; take?: number } = {}) {
  return prisma.notification.findMany({
    where: { recipientUserId: ctx.userId, ...(opts.unreadOnly && { readAt: null }) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 100, 200),
    select: { id: true, eventType: true, title: true, body: true, href: true, readAt: true, createdAt: true, organization: { select: { id: true, displayName: true } } },
  });
}

export async function unreadCount(ctx: AuthContext): Promise<number> {
  return prisma.notification.count({ where: { recipientUserId: ctx.userId, readAt: null } });
}

/** Marks one of your notifications read. Someone else's is "not found". */
export async function markRead(ctx: AuthContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Notification not found.");
  const r = await prisma.notification.updateMany({ where: { id, recipientUserId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
  if (r.count === 0 && !(await prisma.notification.findFirst({ where: { id, recipientUserId: ctx.userId }, select: { id: true } }))) throw new NotFoundError("Notification not found.");
}

export async function markAllRead(ctx: AuthContext): Promise<number> {
  const r = await prisma.notification.updateMany({ where: { recipientUserId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
  return r.count;
}

// ───────────────────────────── Following ─────────────────────────────

async function followable(tx: Tx, organizationId: string) {
  if (!z.uuid().safeParse(organizationId).success) throw new NotFoundError("Carrier not found.");
  const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, type: true, displayName: true } });
  if (!org || org.type === "AGENCY") throw new NotFoundError("Carrier not found.");
  return org;
}

export async function isFollowing(ctx: AuthContext, organizationId: string): Promise<boolean> {
  return !!(await prisma.carrierFollow.findUnique({ where: { userId_organizationId: { userId: ctx.userId, organizationId } } }));
}

export async function follow(ctx: AuthContext, organizationId: string) {
  assertCan(ctx, "carrier.read");
  return prisma.$transaction(async (tx) => {
    const org = await followable(tx, organizationId);
    const existing = await tx.carrierFollow.findUnique({ where: { userId_organizationId: { userId: ctx.userId, organizationId } } });
    if (existing) return existing;
    const row = await tx.carrierFollow.create({ data: { userId: ctx.userId, organizationId: org.id } });
    await recordAudit(tx, ctx, { action: "carrier.follow", entityType: "organization", entityId: org.id, after: row });
    return row;
  });
}

export async function unfollow(ctx: AuthContext, organizationId: string) {
  assertCan(ctx, "carrier.read");
  return prisma.$transaction(async (tx) => {
    const org = await followable(tx, organizationId);
    const existing = await tx.carrierFollow.findUnique({ where: { userId_organizationId: { userId: ctx.userId, organizationId } } });
    if (!existing) return;
    await tx.carrierFollow.delete({ where: { userId_organizationId: { userId: ctx.userId, organizationId } } });
    await recordAudit(tx, ctx, { action: "carrier.unfollow", entityType: "organization", entityId: org.id, before: existing });
  });
}

export async function listFollowing(ctx: AuthContext) {
  return prisma.carrierFollow.findMany({ where: { userId: ctx.userId }, include: { organization: { select: { id: true, displayName: true, type: true } } }, orderBy: { organization: { displayName: "asc" } } });
}

// ───────────────────────────── Daily reminders ─────────────────────────────

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Approved appetite whose review is due: followers of the carrier and the profile owner are
 * told once per profile and review date. (Appointment expiry reminders were removed: appointments
 * are managed by corporate, DECISIONS N19.)
 * Runs from the cron route (ctx null) or by an admin.
 */
export async function runReminders(ctx: AuthContext | null): Promise<{ created: number; appetite: number }> {
  if (ctx) assertCan(ctx, "admin.settings");
  return prisma.$transaction(async (tx) => {
    let created = 0;
    const profiles = await tx.appetiteProfile.findMany({
      where: { status: "APPROVED", nextReviewAt: { lte: new Date() } },
      include: { marketChannel: { select: { intermediaryOrgId: true } }, carrierProduct: { include: { writingCompany: { select: { id: true, displayName: true } }, product: { select: { name: true } } } } },
    });
    for (const p of profiles) {
      const wc = p.carrierProduct.writingCompany;
      const orgIds = [wc.id, ...(p.marketChannel?.intermediaryOrgId ? [p.marketChannel.intermediaryOrgId] : [])];
      const recipients = [...(await followersOf(tx, orgIds)), ...(p.ownerUserId ? [p.ownerUserId] : [])];
      created += await send(tx, recipients, null, {
        eventType: "APPETITE_REVIEW_DUE",
        title: `Appetite review due: ${wc.displayName} · ${p.carrierProduct.product.name} (v${p.version})`,
        href: `/appetite/${p.id}`,
        organizationId: wc.id,
        payload: { appetiteProfileId: p.id },
        dedupeKey: `appetite-review:${p.id}:${day(p.nextReviewAt!)}`,
      });
    }
    if (ctx) await recordAudit(tx, ctx, { action: "notifications.reminders.run", entityType: "notification", entityId: null, after: { created, appetite: profiles.length } });
    return { created, appetite: profiles.length };
  });
}
