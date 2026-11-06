import type { Prisma } from "@/generated/prisma/client";
import type { RecordType } from "@/generated/prisma/enums";
import { recordAudit, snapshot } from "@/server/audit";
import type { AuthContext } from "@/server/auth/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { onChangeRequestClosed, onChangeRequestOpened } from "./notifications";

type Tx = Prisma.TransactionClient;

/**
 * Change requests (DECISIONS D14). Submitting a record for approval opens a PENDING change
 * request. A reviewer other than the submitter approves or rejects it; an ADMIN may approve
 * their own only with a written reason. Every step is audited.
 */
export async function openChangeRequest(
  tx: Tx,
  ctx: AuthContext,
  r: { recordType: RecordType; recordId: string; proposed: unknown; note?: string | null },
) {
  const open = await tx.changeRequest.findFirst({ where: { recordType: r.recordType, recordId: r.recordId, status: "PENDING" } });
  if (open) throw new ConflictError("This is already waiting for approval.");
  const cr = await tx.changeRequest.create({
    data: { recordType: r.recordType, recordId: r.recordId, proposedPatch: snapshot(r.proposed) ?? {}, proposedById: ctx.userId, rationale: r.note ?? null },
  });
  await recordAudit(tx, ctx, { action: "change_request.open", entityType: "change_request", entityId: cr.id, after: cr });
  await onChangeRequestOpened(tx, ctx, cr);
  return cr;
}

/** Enforces D14 for a decision. Returns the rationale to store. */
export function checkReviewer(ctx: AuthContext, cr: { proposedById: string }, decision: "APPROVE" | "REJECT", rationale: string | undefined): string | null {
  const own = cr.proposedById === ctx.userId;
  if (own && decision === "APPROVE") {
    if (!ctx.roles.includes("ADMIN")) throw new ForbiddenError("You can't approve your own submission. Ask someone else to review it.");
    if (!rationale || rationale.trim().length < 10) throw new ValidationError("Approving your own submission needs a reason (at least 10 characters).");
  }
  if (decision === "REJECT" && (!rationale || !rationale.trim())) throw new ValidationError("Say why you're rejecting it.");
  return rationale?.trim() || null;
}

export async function closeChangeRequest(
  tx: Tx,
  ctx: AuthContext,
  crId: string,
  status: "APPROVED" | "REJECTED" | "WITHDRAWN",
  rationale: string | null,
) {
  const before = await tx.changeRequest.findUniqueOrThrow({ where: { id: crId } });
  const after = await tx.changeRequest.update({
    where: { id: crId },
    data: { status, reviewedById: status === "WITHDRAWN" ? null : ctx.userId, reviewedAt: status === "WITHDRAWN" ? null : new Date(), rationale: rationale ?? before.rationale },
  });
  await recordAudit(tx, ctx, { action: `change_request.${status.toLowerCase()}`, entityType: "change_request", entityId: crId, before, after });
  await onChangeRequestClosed(tx, ctx, after);
  return after;
}

export async function pendingRequestFor(tx: Tx, recordType: RecordType, recordId: string) {
  return tx.changeRequest.findFirst({ where: { recordType, recordId, status: "PENDING" }, include: { proposedBy: { select: { name: true } } } });
}
