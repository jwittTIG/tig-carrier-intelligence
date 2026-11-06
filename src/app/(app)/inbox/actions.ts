"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { formObject } from "@/server/validation";
import * as inbox from "@/server/services/inbox";

const page = (id: string) => `/inbox/${id}`;

export async function runIntakeAction(_s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const r = await inbox.runIntake(await requireAuth());
    revalidatePath("/inbox");
    const base = `Checked ${r.checked}: ${r.added} new${r.held ? ` (${r.held} held for review)` : ""}, ${r.duplicates} already in.`;
    return r.errors.length ? `${base} Problems: ${r.errors.slice(0, 3).join("; ")}` : base;
  });
}

export async function fileAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inbox.fileUnderCarrier(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
    return "Filed under the carrier.";
  });
}

export async function citeAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inbox.citeAsSource(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
    return "Added as a source.";
  });
}

export async function appetiteDraftAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  let profileId = "";
  const r = await runAction(async () => {
    profileId = (await inbox.startAppetiteDraft(await requireAuth(), id, formObject(form))).profileId;
  });
  if (r?.error) return r;
  redirect(`/appetite/${profileId}`);
}

export async function dismissAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inbox.dismissMessage(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
    return "Dismissed.";
  });
}

export async function heldAction(id: string, decision: "ACCEPT" | "DISCARD", _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inbox.decideHeld(await requireAuth(), id, { decision, reason: form.get("reason") });
    revalidatePath(page(id));
    revalidatePath("/inbox");
    return decision === "ACCEPT" ? "Accepted; attachments checked and stored." : "Discarded.";
  });
}
