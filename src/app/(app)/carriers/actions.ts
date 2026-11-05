"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { formObject } from "@/server/validation";
import * as carriers from "@/server/services/carriers";

const page = (id: string) => `/carriers/${id}`;

export async function createCarrierAction(_s: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const result = await runAction(async () => {
    const ctx = await requireAuth();
    id = (await carriers.createCarrier(ctx, formObject(form))).id;
  });
  if (result?.error) return result;
  redirect(page(id));
}

export async function updateCarrierAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireAuth();
    const f = formObject(form);
    // Empty selects clear the field.
    await carriers.updateCarrier(ctx, id, { ...f, parentId: f.parentId || null, ownerUserId: f.ownerUserId || null, website: f.website || null });
    revalidatePath(page(id));
  });
}

export async function setArchivedAction(id: string, archived: boolean, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireAuth();
    await carriers.setCarrierArchived(ctx, id, archived);
    revalidatePath(page(id));
    return archived ? "Archived." : "Restored.";
  });
}

export async function addIdentifierAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await carriers.addIdentifier(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
    return "Identifier added.";
  });
}

export async function removeIdentifierAction(id: string, identifierId: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await carriers.removeIdentifier(await requireAuth(), id, identifierId);
    revalidatePath(page(id));
    return "Removed.";
  });
}

export async function addRelationshipAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await carriers.addRelationship(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
    return "Relationship added.";
  });
}

export async function endRelationshipAction(id: string, relationshipId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await carriers.endRelationship(await requireAuth(), id, relationshipId, formObject(form));
    revalidatePath(page(id));
    return "Relationship ended.";
  });
}

export async function addProductAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await carriers.addCarrierProduct(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
    return "Product added.";
  });
}

export async function addChannelAction(id: string, carrierProductId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await carriers.addChannel(await requireAuth(), id, carrierProductId, formObject(form));
    revalidatePath(page(id));
    return "Channel added.";
  });
}

export async function setProductArchivedAction(id: string, carrierProductId: string, archived: boolean, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await carriers.setCarrierProductArchived(await requireAuth(), id, carrierProductId, archived);
    revalidatePath(page(id));
    return archived ? "Product archived." : "Product restored.";
  });
}

export async function setChannelArchivedAction(id: string, channelId: string, archived: boolean, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await carriers.setChannelArchived(await requireAuth(), id, channelId, archived);
    revalidatePath(page(id));
    return archived ? "Channel archived." : "Channel restored.";
  });
}

export async function addActivityAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await carriers.addActivity(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
    return "Note added.";
  });
}
