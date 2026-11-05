import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { optionalDate, optionalId, optionalText, parse } from "@/server/validation";

/** Audit log viewer (PRD screen 10). Read-only: the table is append-only in the database. */

const schema = z.object({
  entityType: optionalText(60),
  action: optionalText(80),
  actorId: optionalId,
  entityId: optionalId,
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listAuditEvents(ctx: AuthContext, filters: z.input<typeof schema> = {}) {
  assertCan(ctx, "audit.read");
  const f = parse(schema, filters);
  const where: Prisma.AuditEventWhereInput = {
    ...(f.entityType && { entityType: f.entityType }),
    ...(f.action && { action: { startsWith: f.action } }),
    ...(f.actorId && { actorId: f.actorId }),
    ...(f.entityId && { entityId: f.entityId }),
    ...((f.from || f.to) && { occurredAt: { ...(f.from && { gte: f.from }), ...(f.to && { lt: new Date(f.to.getTime() + 86_400_000) }) } }),
  };
  const total = await prisma.auditEvent.count({ where });
  const items = await prisma.auditEvent.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: (f.page - 1) * f.pageSize,
    take: f.pageSize,
    include: { actor: { select: { name: true } } },
  });
  const entityTypes = (await prisma.auditEvent.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } })).map((e) => e.entityType);
  return { total, page: f.page, pageSize: f.pageSize, items, entityTypes };
}
