"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { formObject } from "@/server/validation";
import * as appts from "@/server/services/appointments";

const page = (carrierId: string) => `/carriers/${carrierId}`;

export async function createAppointmentAction(carrierId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await appts.createAppointment(await requireAuth(), formObject(form));
    revalidatePath(page(carrierId));
    return "Appointment added.";
  });
}

export async function updateAppointmentAction(carrierId: string, appointmentId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await appts.updateAppointment(await requireAuth(), appointmentId, formObject(form));
    revalidatePath(page(carrierId));
  });
}

export async function addAuthorizationAction(carrierId: string, appointmentId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await appts.addAuthorization(await requireAuth(), appointmentId, formObject(form));
    revalidatePath(page(carrierId));
    return "Authorization added.";
  });
}

export async function removeAuthorizationAction(carrierId: string, appointmentId: string, authorizationId: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await appts.removeAuthorization(await requireAuth(), appointmentId, authorizationId);
    revalidatePath(page(carrierId));
    return "Removed.";
  });
}

export async function addCodeAction(carrierId: string, appointmentId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await appts.addAgencyCode(await requireAuth(), appointmentId, formObject(form));
    revalidatePath(page(carrierId));
    return "Code added.";
  });
}

export async function updateCodeAction(carrierId: string, appointmentId: string, codeId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await appts.updateAgencyCode(await requireAuth(), appointmentId, codeId, formObject(form));
    revalidatePath(page(carrierId));
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
    return "Removed.";
  });
}
