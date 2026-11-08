"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { formObject } from "@/server/validation";
import { applyExtraction, retrySkipped, startExtraction } from "@/server/services/extractions";

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
  const r = await runAction(async () => {
    await applyExtraction(await requireAuth(), id, { attributes: all("attributes"), rules: all("rules"), limits: all("limits"), requirements: all("requirements") });
    revalidatePath(`/extractions/${id}`);
    return "Draft created.";
  });
  return r;
}

export async function retrySkippedAction(id: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const r = await retrySkipped(await requireAuth(), id);
    revalidatePath(`/extractions/${id}`);
    const n = r.retried.rules + r.retried.riskDetails + r.retried.limits + r.retried.requirements;
    return `Added ${n} of the skipped items${r.skipped.length ? `; ${r.skipped.length} still skipped` : ""}.`;
  });
}
