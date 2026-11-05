import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/server/auth/context";

type Tx = Prisma.TransactionClient;

/** JSON-safe snapshot: Decimals and BigInts become strings, Dates ISO strings. */
export function snapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** Append-only audit entry. Call inside the same transaction as the write it describes. */
export async function recordAudit(
  tx: Tx,
  ctx: AuthContext,
  entry: { action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown },
) {
  await tx.auditEvent.create({
    data: {
      actorId: ctx.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      beforeState: snapshot(entry.before),
      afterState: snapshot(entry.after),
      correlationId: ctx.correlationId,
    },
  });
}
