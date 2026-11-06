"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { formObject } from "@/server/validation";
import * as industries from "@/server/services/industries";

const page = (system: string, code: string) => `/industries/${system}/${code}`;

export async function addKeywordAction(system: string, code: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const row = await industries.addKeyword(await requireAuth(), system, code, formObject(form));
    revalidatePath(page(system, code));
    return `Added "${row.keyword}". Searching for it in the Market Finder now finds this code.`;
  });
}

export async function removeKeywordAction(system: string, code: string, id: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const row = await industries.removeKeyword(await requireAuth(), id);
    revalidatePath(page(system, code));
    return `Removed "${row.keyword}".`;
  });
}
