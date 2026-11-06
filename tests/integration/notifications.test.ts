import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cron from "@/app/api/cron/reminders/route";
import { loadAuthContext, type AuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listAgencyEntities } from "@/server/services/appointments";
import { decide } from "@/server/services/approvals";
import { addCarrierProduct, addChannel, createCarrier, listProducts } from "@/server/services/carriers";
import * as com from "@/server/services/commissions";
import { uploadDocument } from "@/server/services/documents";
import * as inbox from "@/server/services/inbox";
import * as n from "@/server/services/notifications";
import { demoContext, testUser } from "../support/auth";
import { testPrisma } from "../support/db";
import { eml, MemoryDriver, pdfBytes } from "../support/eml";

/** Notifications (D23): followers, submitters, never the actor, own-only access, reminders once. */
const db = testPrisma();
let staff: AuthContext; // submits
let admin: AuthContext;
let reviewer: AuthContext;
let follower: AuthContext;
afterAll(() => db.$disconnect());

const ctxFor = async (opts: Parameters<typeof testUser>[1] = {}) => (await loadAuthContext((await testUser(db, opts)).id))!;
const t = () => randomUUID().slice(0, 6);
const mine = (ctx: AuthContext) => db.notification.findMany({ where: { recipientUserId: ctx.userId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  staff = await demoContext(db, "demo.producer@example.invalid");
  admin = await demoContext(db, "demo.admin@example.invalid");
  reviewer = await ctxFor({ role: "STAFF" });
  follower = await ctxFor({ role: "STAFF" });
});

async function carrierWithAgreement() {
  const insurer = await createCarrier(staff, { legalName: `TEST Nt ${t()} Co`, displayName: `TEST Nt ${t()}`, type: "INSURER" });
  const product = (await listProducts(staff))[0];
  const cp = await addCarrierProduct(staff, insurer.id, { productId: product.id });
  const ch = await addChannel(staff, insurer.id, cp.id, { distributionType: "DIRECT" });
  const entity = (await listAgencyEntities(staff))[0];
  const doc = await uploadDocument(staff, { title: "TEST Agency agreement", documentType: "AGREEMENT", classification: "RESTRICTED" }, { name: "agreement.pdf", bytes: pdfBytes("agreement") });
  const agreement = await com.createAgreement(staff, { agencyEntityId: entity.id, marketChannelId: ch.id, agreementRef: `TEST-${t()}`, sourceDocumentVersionId: doc.version.id });
  return { insurer, cp, ch, entity, agreement };
}
const crFor = (id: string) => db.changeRequest.findFirstOrThrow({ where: { recordId: id, status: "PENDING" } });

describe("following", () => {
  it("follow and unfollow are idempotent, audited, and only for carriers", async () => {
    const { insurer } = await carrierWithAgreement();
    await n.follow(follower, insurer.id);
    await n.follow(follower, insurer.id);
    expect(await n.isFollowing(follower, insurer.id)).toBe(true);
    expect((await n.listFollowing(follower)).map((f) => f.organizationId)).toContain(insurer.id);
    await n.unfollow(follower, insurer.id);
    expect(await n.isFollowing(follower, insurer.id)).toBe(false);
    expect(await db.auditEvent.count({ where: { entityId: insurer.id, action: { in: ["carrier.follow", "carrier.unfollow"] } } })).toBe(2);
    const agencyOrg = await db.organization.findFirstOrThrow({ where: { type: "AGENCY" } });
    await expect(n.follow(follower, agencyOrg.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(n.follow(follower, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("approval events", () => {
  it("submission notifies followers but not the submitter; approval notifies the submitter and followers, not the reviewer", async () => {
    const { insurer, agreement } = await carrierWithAgreement();
    await n.follow(follower, insurer.id);
    await n.follow(staff, insurer.id); // the submitter follows too
    await n.follow(reviewer, insurer.id); // and so does the reviewer
    const inactive = await testUser(db, { role: "STAFF", status: "DEACTIVATED" });
    await db.carrierFollow.create({ data: { userId: inactive.id, organizationId: insurer.id } });

    await com.submitAgreement(staff, agreement.id, {});
    const submitted = await db.notification.findMany({ where: { organizationId: insurer.id, eventType: "CHANGE_REQUEST_SUBMITTED" } });
    expect(submitted.map((x) => x.recipientUserId).sort()).toEqual([follower.userId, reviewer.userId].sort());
    expect(submitted[0].title).toMatch(/submitted the commission agreement with TEST Nt/);
    expect(submitted[0].href).toBe(`/commissions/${agreement.id}`);

    await decide(reviewer, (await crFor(agreement.id)).id, { decision: "APPROVE" });
    const decided = await db.notification.findMany({ where: { organizationId: insurer.id, eventType: { in: ["CHANGE_REQUEST_APPROVED", "RECORD_APPROVED"] } } });
    expect(decided.map((x) => [x.eventType, x.recipientUserId]).sort()).toEqual([
      ["CHANGE_REQUEST_APPROVED", staff.userId],
      ["RECORD_APPROVED", follower.userId],
    ].sort());
    expect(decided.every((x) => x.actorUserId === reviewer.userId)).toBe(true);
    expect(await db.notification.count({ where: { recipientUserId: inactive.id } })).toBe(0);
  });

  it("a rejection tells the submitter why", async () => {
    const { agreement } = await carrierWithAgreement();
    await com.submitAgreement(staff, agreement.id, {});
    await decide(reviewer, (await crFor(agreement.id)).id, { decision: "REJECT", rationale: "TEST: wrong agreement attached" });
    const r = await db.notification.findFirstOrThrow({ where: { recipientUserId: staff.userId, eventType: "CHANGE_REQUEST_REJECTED", payload: { path: ["recordId"], equals: agreement.id } } });
    expect(r.body).toBe("TEST: wrong agreement attached");
    expect(r.title).toMatch(/rejected your submission/);
  });
});

describe("inbox filing", () => {
  it("notifies followers once when an email is filed under their carrier", async () => {
    const { insurer } = await carrierWithAgreement();
    await n.follow(follower, insurer.id);
    const subject = `TEST notify ${t()}`;
    await inbox.runIntake(admin, new MemoryDriver().add(eml({ from: "DEMO Producer <demo.producer@example.invalid>", subject, body: "TEST bulletin" })));
    const m = await db.inboundMessage.findFirstOrThrow({ where: { subject } });
    await inbox.fileUnderCarrier(staff, m.id, { organizationId: insurer.id });
    await inbox.fileUnderCarrier(staff, m.id, { organizationId: insurer.id }); // filing again doesn't repeat it
    const got = await db.notification.findMany({ where: { recipientUserId: follower.userId, eventType: "INBOX_FILED", organizationId: insurer.id } });
    expect(got).toHaveLength(1);
    expect(got[0].href).toBe(`/inbox/${m.id}`);
    expect(await db.notification.count({ where: { recipientUserId: staff.userId, eventType: "INBOX_FILED", organizationId: insurer.id } })).toBe(0);
  });
});

describe("reading your own", () => {
  it("lists and marks only your own notifications", async () => {
    const someone = await ctxFor({ role: "STAFF" });
    const other = await ctxFor({ role: "STAFF" });
    const row = await db.notification.create({ data: { recipientUserId: someone.userId, eventType: "RECORD_APPROVED", title: "TEST for someone", href: "/dashboard" } });
    await db.notification.create({ data: { recipientUserId: someone.userId, eventType: "RECORD_APPROVED", title: "TEST second" } });
    expect(await n.unreadCount(someone)).toBe(2);
    expect(await n.listNotifications(other)).toEqual([]);
    await expect(n.markRead(other, row.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).toBeNull();
    await n.markRead(someone, row.id);
    await n.markRead(someone, row.id); // already read: fine
    expect(await n.unreadCount(someone)).toBe(1);
    expect((await n.listNotifications(someone, { unreadOnly: true })).map((x) => x.title)).toEqual(["TEST second"]);
    expect(await n.markAllRead(other)).toBe(0);
    expect(await n.markAllRead(someone)).toBe(1);
    expect(await n.unreadCount(someone)).toBe(0);
  });

  it("links can only point inside the app (database check)", async () => {
    await expect(db.notification.create({ data: { recipientUserId: staff.userId, eventType: "RECORD_APPROVED", title: "TEST", href: "https://example.invalid" } })).rejects.toThrow();
    await expect(db.notification.create({ data: { recipientUserId: staff.userId, eventType: "RECORD_APPROVED", title: "TEST", href: "//example.invalid" } })).rejects.toThrow();
  });
});

describe("daily reminders", () => {
  it("expiring appointments and due appetite reviews notify followers and owners once", async () => {
    const { insurer, cp, ch, entity } = await carrierWithAgreement();
    const owner = await ctxFor({ role: "STAFF" });
    await n.follow(follower, insurer.id);
    const soon = new Date(Date.now() + 10 * 86_400_000);
    const appt = await db.agencyAppointment.create({ data: { agencyEntityId: entity.id, marketChannelId: ch.id, appointmentType: "Direct", status: "ACTIVE", effectiveFrom: new Date("2025-01-01"), effectiveTo: new Date(soon.toISOString().slice(0, 10)) } });
    const far = await db.agencyAppointment.create({ data: { agencyEntityId: entity.id, marketChannelId: ch.id, appointmentType: "Other", status: "ACTIVE", effectiveFrom: new Date("2025-01-01"), effectiveTo: new Date("2099-01-01") } });
    const profile = await db.appetiteProfile.create({
      data: { carrierProductId: cp.id, version: 1, status: "APPROVED", effectiveFrom: new Date("2025-01-01"), ownerUserId: owner.userId, approvedById: admin.userId, approvedAt: new Date(), verifiedAt: new Date("2025-01-01"), nextReviewAt: new Date("2026-01-01") },
    });

    await n.runReminders(null);
    await n.runReminders(admin); // again: no duplicates
    const forFollower = await db.notification.findMany({ where: { recipientUserId: follower.userId, organizationId: insurer.id, eventType: { in: ["APPOINTMENT_EXPIRING", "APPETITE_REVIEW_DUE"] } } });
    expect(forFollower.map((x) => x.eventType).sort()).toEqual(["APPETITE_REVIEW_DUE", "APPOINTMENT_EXPIRING"]);
    expect(forFollower.find((x) => x.eventType === "APPOINTMENT_EXPIRING")!.payload).toEqual({ appointmentId: appt.id });
    expect(await db.notification.count({ where: { payload: { path: ["appointmentId"], equals: far.id } } })).toBe(0);
    const forOwner = await mine(owner);
    expect(forOwner.map((x) => [x.eventType, x.href])).toEqual([["APPETITE_REVIEW_DUE", `/appetite/${profile.id}`]]);
    expect(await db.auditEvent.count({ where: { action: "notifications.reminders.run", actorId: admin.userId } })).toBeGreaterThan(0);
  });

  it("only admins can run them by hand", async () => {
    await expect(n.runReminders(staff)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the cron route needs the CRON_SECRET bearer token", async () => {
    const prev = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await cron.GET(new Request("http://localhost/api/cron/reminders"))).status).toBe(401);
      process.env.CRON_SECRET = "r".repeat(40);
      expect((await cron.GET(new Request("http://localhost/api/cron/reminders", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
      const ok = await cron.GET(new Request("http://localhost/api/cron/reminders", { headers: { authorization: `Bearer ${"r".repeat(40)}` } }));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ created: expect.any(Number) });
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
