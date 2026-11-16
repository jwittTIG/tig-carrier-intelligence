import { z } from "zod";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, ValidationError } from "@/server/errors";
import { optionalText, parse } from "@/server/validation";
import { submitProfile, updateProfile } from "./appetite";
import { approveProfileNow } from "./approvals";
import { checkReviewer } from "./approvals-core";
import { applyExtraction } from "./extractions";

/**
 * One step from an AI draft to an approved (or submitted) appetite version (Josh, 2026-11-16:
 * "the appetite approval process is a little clunky"). The rules of D14 are unchanged: an admin
 * approving their own work types a reason; everyone else submits it for someone else.
 */
const finishSchema = z.object({
  intent: z.enum(["draft", "approve", "submit"]).default("draft"),
  rationale: optionalText(2000),
  effectiveFrom: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-01-01").optional()),
});

export type FinishResult = { profileId: string; outcome: "draft" | "approved" | "submitted"; stopped?: string };

export async function applyAndFinish(ctx: AuthContext, extractionId: string, selection: unknown, input: unknown): Promise<FinishResult> {
  const { intent, rationale, effectiveFrom } = parse(finishSchema, input);
  if (intent === "approve") {
    // Checked before anything changes, so a missing reason or permission leaves nothing half-done.
    assertCan(ctx, "appetite.approve");
    assertCan(ctx, "change_request.review");
    checkReviewer(ctx, { proposedById: ctx.userId }, "APPROVE", rationale);
  }
  const applied = await applyExtraction(ctx, extractionId, selection);
  if (intent === "draft") return { profileId: applied.profileId, outcome: "draft" };

  // The date chosen on the review page, if it differs from the draft's.
  const draft = await prisma.appetiteProfile.findUnique({ where: { id: applied.profileId }, select: { status: true, effectiveFrom: true } });
  if (effectiveFrom && draft?.status === "DRAFT" && draft.effectiveFrom?.toISOString().slice(0, 10) !== effectiveFrom) {
    await updateProfile(ctx, applied.profileId, { effectiveFrom });
  }
  try {
    if (intent === "approve") await approveProfileNow(ctx, applied.profileId, { rationale });
    else await submitProfile(ctx, applied.profileId, { note: rationale });
    return { profileId: applied.profileId, outcome: intent === "approve" ? "approved" : "submitted" };
  } catch (e) {
    // The draft stays; the person finishes it on the draft's page.
    if (e instanceof ValidationError || e instanceof ConflictError) return { profileId: applied.profileId, outcome: "draft", stopped: e.message };
    throw e;
  }
}
