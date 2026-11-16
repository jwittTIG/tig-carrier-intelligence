"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { ValidationError } from "@/server/errors";
import { formObject } from "@/server/validation";
import * as app from "@/server/services/appetite";
import { approveProfileNow, decide } from "@/server/services/approvals";
import * as com from "@/server/services/commissions";
import * as docs from "@/server/services/documents";
import { queueAutoDraft, queueExtraction, runQueuedExtraction } from "@/server/services/extractions";
import { addSource } from "@/server/services/sources";

/** Server actions for Milestone 4 screens: documents, appetite, commissions, approvals. */

async function fileFrom(form: FormData) {
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) throw new ValidationError("Choose a file to upload.");
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}

// ── Documents ──

export async function uploadDocumentAction(returnTo: string | null, _s: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await requireAuth();
    const res = await docs.uploadDocument(ctx, formObject(form), await fileFrom(form));
    id = res.document.id;
    if (returnTo) revalidatePath(returnTo);
    return "Uploaded.";
  });
  if (r?.error || returnTo) return r;
  redirect(`/documents/${id}`);
}

export async function uploadVersionAction(documentId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireAuth();
    const v = await docs.uploadVersion(ctx, documentId, await fileFrom(form));
    revalidatePath(`/documents/${documentId}`);
    // A guide that already has drafted appetite: the new version replaces it, read in the background (N24).
    const queued = await queueAutoDraft(ctx, v.id);
    if (queued) {
      after(() => runQueuedExtraction(ctx, queued));
      return `Version ${v.versionNumber} uploaded. AI is reading it to update the appetite (a few minutes); the carrier’s Appetite tab shows when it’s ready for review.`;
    }
    return `Version ${v.versionNumber} uploaded.`;
  });
}

export async function updateDocumentAction(documentId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await docs.updateDocument(await requireAuth(), documentId, formObject(form));
    revalidatePath(`/documents/${documentId}`);
  });
}

export async function archiveDocumentAction(documentId: string, archived: boolean, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await docs.setDocumentArchived(await requireAuth(), documentId, archived);
    revalidatePath(`/documents/${documentId}`);
    return archived ? "Archived." : "Restored.";
  });
}

export async function uploadSourceAction(returnTo: string, recordType: string, recordId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const r = await docs.uploadAsSource(await requireAuth(), { ...formObject(form), recordType, recordId }, await fileFrom(form));
    revalidatePath(returnTo);
    return `Uploaded "${r.document.title}" and added it as a source.`;
  });
}

export async function addSourceAction(returnTo: string, recordType: string, recordId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await addSource(await requireAuth(), { ...formObject(form), recordType, recordId });
    revalidatePath(returnTo);
    return "Source added.";
  });
}

// ── Appetite ──

const profilePath = (id: string) => `/appetite/${id}`;

export async function createProfileAction(carrierId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async () => {
    id = (await app.createProfile(await requireAuth(), formObject(form))).id;
    revalidatePath(`/carriers/${carrierId}`);
  });
  if (r?.error) return r;
  redirect(profilePath(id));
}

export async function updateProfileAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await app.updateProfile(await requireAuth(), id, formObject(form));
    revalidatePath(profilePath(id));
  });
}

export async function addRuleAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await app.addRule(await requireAuth(), id, { ...formObject(form), territoryIds: form.getAll("territoryIds").map(String) });
    revalidatePath(profilePath(id));
    return "Rule added.";
  });
}

export async function removeRuleAction(id: string, ruleId: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await app.removeRule(await requireAuth(), id, ruleId);
    revalidatePath(profilePath(id));
    return "Removed.";
  });
}

export async function addAttributeAction(id: string, productId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await app.addAttributeDefinition(await requireAuth(), productId, formObject(form));
    revalidatePath(profilePath(id));
    return "Attribute defined.";
  });
}

export async function addCoverageAction(id: string, carrierProductId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await app.addCoverage(await requireAuth(), carrierProductId, formObject(form));
    revalidatePath(profilePath(id));
    return "Coverage added.";
  });
}

export async function removeCoverageAction(id: string, carrierProductId: string, coverageId: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await app.removeCoverage(await requireAuth(), carrierProductId, coverageId);
    revalidatePath(profilePath(id));
    return "Removed.";
  });
}

export async function addRequirementAction(id: string, carrierProductId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await app.addRequirement(await requireAuth(), carrierProductId, formObject(form));
    revalidatePath(profilePath(id));
    return "Requirement added.";
  });
}

export async function removeRequirementAction(id: string, carrierProductId: string, requirementId: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await app.removeRequirement(await requireAuth(), carrierProductId, requirementId);
    revalidatePath(profilePath(id));
    return "Removed.";
  });
}

export async function submitProfileAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await app.submitProfile(await requireAuth(), id, formObject(form));
    revalidatePath(profilePath(id));
    return "Submitted for approval.";
  });
}

export async function withdrawProfileAction(id: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await app.withdrawProfile(await requireAuth(), id);
    revalidatePath(profilePath(id));
    return "Withdrawn.";
  });
}

export async function newVersionAction(id: string, _s: ActionState): Promise<ActionState> {
  let next = "";
  const r = await runAction(async () => {
    next = (await app.newVersion(await requireAuth(), id)).id;
  });
  if (r?.error) return r;
  redirect(profilePath(next));
}

export async function verifyProfileAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await app.verifyProfile(await requireAuth(), id, formObject(form));
    revalidatePath(profilePath(id));
    return "Confirmed.";
  });
}

export async function deleteDraftAction(id: string, carrierId: string, _s: ActionState): Promise<ActionState> {
  const r = await runAction(async () => {
    await app.deleteDraft(await requireAuth(), id);
  });
  if (r?.error) return r;
  redirect(`/carriers/${carrierId}?tab=appetite`);
}

// ── Commissions ──

const agreementPath = (id: string) => `/commissions/${id}`;

export async function createAgreementAction(carrierId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async () => {
    id = (await com.createAgreement(await requireAuth(), formObject(form))).id;
    revalidatePath(`/carriers/${carrierId}`);
  });
  if (r?.error) return r;
  redirect(agreementPath(id));
}

export async function updateAgreementAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await com.updateAgreement(await requireAuth(), id, formObject(form));
    revalidatePath(agreementPath(id));
  });
}

export async function submitAgreementAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await com.submitAgreement(await requireAuth(), id, formObject(form));
    revalidatePath(agreementPath(id));
    return "Submitted for approval.";
  });
}

export async function addScheduleAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await com.addSchedule(await requireAuth(), id, formObject(form));
    revalidatePath(agreementPath(id));
    return "Draft schedule added.";
  });
}

export async function addTierAction(id: string, scheduleId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await com.addTier(await requireAuth(), id, scheduleId, formObject(form));
    revalidatePath(agreementPath(id));
    return "Tier added.";
  });
}

export async function submitScheduleAction(id: string, scheduleId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await com.submitSchedule(await requireAuth(), id, scheduleId, formObject(form));
    revalidatePath(agreementPath(id));
    return "Submitted for approval.";
  });
}

export async function deleteScheduleAction(id: string, scheduleId: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await com.deleteDraftSchedule(await requireAuth(), id, scheduleId);
    revalidatePath(agreementPath(id));
    return "Deleted.";
  });
}

export async function retireScheduleAction(id: string, scheduleId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await com.retireSchedule(await requireAuth(), id, scheduleId, formObject(form));
    revalidatePath(agreementPath(id));
    return "Retired.";
  });
}

export async function withdrawCommissionAction(id: string, recordType: "COMMISSION_AGREEMENT" | "COMMISSION_SCHEDULE", recordId: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await com.withdrawSubmission(await requireAuth(), recordType, recordId);
    revalidatePath(agreementPath(id));
    return "Withdrawn.";
  });
}

// ── Approvals ──

export async function decideAction(changeRequestId: string, decision: "APPROVE" | "REJECT", returnTo: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await decide(await requireAuth(), changeRequestId, { decision, rationale: form.get("rationale") ?? undefined });
    revalidatePath(returnTo);
    revalidatePath("/approvals");
    return decision === "APPROVE" ? "Approved." : "Rejected.";
  });
}

export async function approveProfileNowAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await approveProfileNow(await requireAuth(), id, { rationale: form.get("rationale") ?? undefined });
    revalidatePath(`/appetite/${id}`);
    revalidatePath("/approvals");
    return "Approved. The Market Finder now uses this version.";
  });
}

export async function closeOutProfileAction(id: string, carrierId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await app.closeOutProfile(await requireAuth(), id, formObject(form));
    revalidatePath(`/appetite/${id}`);
    revalidatePath(`/carriers/${carrierId}`);
    return "Closed out.";
  });
}

/**
 * Upload a guide on a carrier's Appetite tab (Josh, 2026-11-16). The name is read from the
 * document. With a product and "Draft appetite from it now", the AI read starts in the background.
 */
export async function uploadGuideAction(carrierId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireAuth();
    const f = formObject(form);
    const res = await docs.uploadDocument(ctx, { documentType: f.documentType, classification: "INTERNAL", organizationId: carrierId }, await fileFrom(form));
    revalidatePath(`/carriers/${carrierId}`);
    const productId = typeof f.carrierProductId === "string" ? f.carrierProductId : "";
    if (!productId || form.get("draftNow") !== "on") return `Uploaded “${res.document.title}”.`;
    try {
      const queued = await queueExtraction(ctx, { documentVersionId: res.version.id, carrierProductId: productId });
      after(() => runQueuedExtraction(ctx, queued));
      return `Uploaded “${res.document.title}”. AI is reading it now (a few minutes); its line below shows when the draft is ready for review.`;
    } catch (e) {
      if (e instanceof ValidationError) return `Uploaded “${res.document.title}”, but the AI read didn't start: ${e.message}`;
      throw e;
    }
  });
}
