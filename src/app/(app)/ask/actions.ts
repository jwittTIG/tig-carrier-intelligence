"use server";

import { redirect } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { formObject } from "@/server/validation";
import { askGuides } from "@/server/services/guides";

export async function askAction(_s: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async () => {
    id = (await askGuides(await requireAuth(), formObject(form))).id;
  });
  if (r?.error) return r;
  redirect(`/ask/${id}`);
}
