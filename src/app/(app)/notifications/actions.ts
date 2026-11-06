"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import * as notifications from "@/server/services/notifications";

export async function markReadAction(id: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await notifications.markRead(await requireAuth(), id);
    revalidatePath("/", "layout");
    return "Marked read.";
  });
}

export async function markAllReadAction(_s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const n = await notifications.markAllRead(await requireAuth());
    revalidatePath("/", "layout");
    return n ? `Marked ${n} read.` : "Nothing unread.";
  });
}

export async function runRemindersAction(_s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const r = await notifications.runReminders(await requireAuth());
    revalidatePath("/", "layout");
    return `Checked ${r.appointments} expiring ${r.appointments === 1 ? "appointment" : "appointments"} and ${r.appetite} appetite ${r.appetite === 1 ? "review" : "reviews"} due: ${r.created} new ${r.created === 1 ? "notification" : "notifications"}.`;
  });
}

export async function followAction(organizationId: string, following: boolean, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireAuth();
    if (following) await notifications.unfollow(ctx, organizationId);
    else await notifications.follow(ctx, organizationId);
    revalidatePath(`/carriers/${organizationId}`);
    return following ? "Unfollowed." : "Following. You'll be notified about approvals, submissions, inbox updates and reminders for this carrier.";
  });
}
