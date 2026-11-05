"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { formObject } from "@/server/validation";
import * as contacts from "@/server/services/contacts";

const page = (id: string) => `/contacts/${id}`;

export async function createContactAction(_s: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const result = await runAction(async () => {
    id = (await contacts.createContact(await requireAuth(), formObject(form))).id;
  });
  if (result?.error) return result;
  redirect(page(id));
}

export async function updateContactAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await contacts.updateContact(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
  });
}

export async function setContactArchivedAction(id: string, archived: boolean, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await contacts.setContactArchived(await requireAuth(), id, archived);
    revalidatePath(page(id));
    return archived ? "Archived." : "Restored.";
  });
}

export async function verifyContactAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await contacts.verifyContact(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
    return "Marked as confirmed.";
  });
}

export async function addAssignmentAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await contacts.addAssignment(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
    return "Assignment added.";
  });
}

export async function updateAssignmentAction(id: string, assignmentId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await contacts.updateAssignment(await requireAuth(), id, assignmentId, formObject(form));
    revalidatePath(page(id));
  });
}

export async function endAssignmentAction(id: string, assignmentId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await contacts.endAssignment(await requireAuth(), id, assignmentId, formObject(form));
    revalidatePath(page(id));
    return "Assignment ended.";
  });
}

export async function addSpecialtyAction(id: string, assignmentId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await contacts.addSpecialty(await requireAuth(), id, assignmentId, formObject(form));
    revalidatePath(page(id));
    return "Specialty added.";
  });
}

export async function removeSpecialtyAction(id: string, specialtyId: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await contacts.removeSpecialty(await requireAuth(), id, specialtyId);
    revalidatePath(page(id));
    return "Removed.";
  });
}

export async function addContactActivityAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await contacts.addContactActivity(await requireAuth(), id, formObject(form));
    revalidatePath(page(id));
    return "Note added.";
  });
}
