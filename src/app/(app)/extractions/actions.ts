"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { formObject } from "@/server/validation";
import { retrySkipped, startExtraction } from "@/server/services/extractions";
import { applyAndFinish, type FinishResult } from "@/server/services/extraction-approval";

export async function startExtractionAction(_s: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async () => {
    id = (await startExtraction(await requireAuth(), formObject(form))).id;
  });
  if (r?.error) return r;
  redirect(`/extractions/${id}`);
}

export async function applyExtractionAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  const all = (k: string) => form.getAll(k).filter((v): v is string => typeof v === "string");
  let done: FinishResult | null = null;
  const r = await runAction(async () => {
    done = await applyAndFinish(
      await requireAuth(),
      id,
      { attributes: all("attributes"), rules: all("rules"), limits: all("limits"), requirements: all("requirements") },
      { intent: form.get("intent") ?? "draft", rationale: form.get("rationale") ?? undefined, effectiveFrom: form.get("effectiveFrom") ?? undefined },
    );
    revalidatePath(`/extractions/${id}`);
    revalidatePath("/approvals");
  });
  if (r?.error) return r;
  const d = done as FinishResult | null;
  if (!d) return r;
  if (d.stopped) {
    const verb = form.get("intent") === "approve" ? "approved" : "submitted";
    return { error: `The draft was created, but not ${verb}: ${d.stopped} Open the appetite draft below to finish.` };
  }
  // Approved or submitted: go to the appetite version itself.
  if (d.outcome !== "draft") redirect(`/appetite/${d.profileId}?done=${d.outcome}`);
  return { ok: "Draft created." };
}

export async function retrySkippedAction(id: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const r = await retrySkipped(await requireAuth(), id);
    revalidatePath(`/extractions/${id}`);
    const n = r.retried.rules + r.retried.riskDetails + r.retried.limits + r.retried.requirements;
    return `Added ${n} of the skipped items${r.skipped.length ? `; ${r.skipped.length} still skipped` : ""}.`;
  });
}
