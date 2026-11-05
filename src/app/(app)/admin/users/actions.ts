"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { formObject } from "@/server/validation";
import { inviteUser, setUserActive, setUserRole } from "@/server/services/users";

export async function inviteUserAction(_s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await inviteUser(await requireAuth(), formObject(form));
    revalidatePath("/admin/users");
    return `Invited ${user.email}. They can sign in with Microsoft 365.`;
  });
}

export async function setRoleAction(userId: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await setUserRole(await requireAuth(), userId, form.get("role"));
    revalidatePath("/admin/users");
    return "Role updated.";
  });
}

export async function setActiveAction(userId: string, active: boolean, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await setUserActive(await requireAuth(), userId, active);
    revalidatePath("/admin/users");
    return active ? "Reactivated." : "Deactivated.";
  });
}
