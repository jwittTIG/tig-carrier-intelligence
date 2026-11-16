import { z } from "zod";
import { addDays } from "@/lib/dates";
import { assertCan, can, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { parse } from "@/server/validation";

/** Global search (P0-08) and the dashboard (PRD screen 1). Only real queries, no sample numbers. */

export async function globalSearch(ctx: AuthContext, q: unknown) {
  assertCan(ctx, "carrier.read");
  const term = parse(z.string().trim().min(2, "Type at least 2 characters").max(100), q);
  const like = { contains: term, mode: "insensitive" as const };
  const carriers = await prisma.organization.findMany({
    where: { type: { not: "AGENCY" }, OR: [{ displayName: like }, { legalName: like }, { identifiers: { some: { value: { equals: term, mode: "insensitive" } } } }] },
    orderBy: [{ archivedAt: { sort: "desc", nulls: "first" } }, { displayName: "asc" }],
    take: 20,
    select: { id: true, displayName: true, type: true, archivedAt: true },
  });
  const words = term.split(/\s+/);
  const contacts = can(ctx, "contact.read")
    ? await prisma.contact.findMany({
        where: {
          archivedAt: null,
          OR: [
            { firstName: like },
            { lastName: like },
            { email: like },
            ...(words.length > 1 ? [{ AND: [{ firstName: { contains: words[0], mode: "insensitive" as const } }, { lastName: { contains: words.slice(1).join(" "), mode: "insensitive" as const } }] }] : []),
          ],
        },
        take: 20,
        orderBy: [{ lastName: "asc" }],
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const codes = can(ctx, "appointment.read")
    ? await prisma.agencyCode.findMany({
        where: { codeValue: like },
        take: 20,
        include: { appointment: { include: { marketChannel: { include: { carrierProduct: { include: { writingCompany: { select: { id: true, displayName: true } } } } } } } } },
      })
    : [];
  const documents = can(ctx, "document.read")
    ? await prisma.document.findMany({
        where: { title: like, status: "ACTIVE", ...(!can(ctx, "commission.read") && { classification: { not: "RESTRICTED" } }) },
        take: 20,
        select: { id: true, title: true, documentType: true },
      })
    : [];
  return { term, carriers, contacts, codes, documents };
}

export async function dashboard(ctx: AuthContext) {
  assertCan(ctx, "carrier.read");
  const now = new Date();

  const myCarriers = await prisma.organization.findMany({
    where: { ownerUserId: ctx.userId, archivedAt: null },
    orderBy: { displayName: "asc" },
    take: 50,
    select: { id: true, displayName: true, type: true },
  });
  const myOverdueAppetite = can(ctx, "appetite.read")
    ? await prisma.appetiteProfile.findMany({
        where: { status: "APPROVED", nextReviewAt: { lte: now }, ownerUserId: ctx.userId },
        include: { carrierProduct: { include: { writingCompany: { select: { displayName: true } }, product: { select: { name: true } } } } },
        orderBy: { nextReviewAt: "asc" },
        take: 20,
      })
    : [];
  const recentAppetite = can(ctx, "appetite.read")
    ? await prisma.appetiteProfile.findMany({
        where: { status: "APPROVED", approvedAt: { gte: addDays(now, -30) } },
        orderBy: { approvedAt: "desc" },
        take: 10,
        include: { carrierProduct: { include: { writingCompany: { select: { id: true, displayName: true } }, product: { select: { name: true } } } }, approvedBy: { select: { name: true } } },
      })
    : [];
  return { myCarriers, myOverdueAppetite, recentAppetite };
}
