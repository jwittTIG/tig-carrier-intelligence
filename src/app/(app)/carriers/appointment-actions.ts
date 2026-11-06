"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { formObject } from "@/server/validation";
import * as appts from "@/server/services/appointments";

const page = (carrierId: string) => `/carriers/${carrierId}`;

export async function addCodeAction(carrierId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await appts.addAgencyCode(await requireAuth(), formObject(form));
    revalidatePath(page(carrierId));
    return "Code added.";
  });
}

export async function updateCodeAction(carrierId: string, codeId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await appts.updateAgencyCode(await requireAuth(), codeId, formObject(form));
    revalidatePath(page(carrierId));
    return "Saved.";
  });
}

export async function addPortalAction(carrierId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await appts.addPortal(await requireAuth(), carrierId, formObject(form));
    revalidatePath(page(carrierId));
    return "Portal link added.";
  });
}

export async function removePortalAction(carrierId: string, portalId: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await appts.removePortal(await requireAuth(), carrierId, portalId);
    revalidatePath(page(carrierId));
  });
}
