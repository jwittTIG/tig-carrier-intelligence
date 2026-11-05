"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/actions/run";
import { ValidationError } from "@/server/errors";
import { commitImport, saveMapping, uploadImport } from "@/server/services/imports";

export async function uploadImportAction(_s: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async () => {
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) throw new ValidationError("Choose a CSV file.");
    id = (await uploadImport(await requireAuth(), { targetType: form.get("targetType") }, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })).id;
  });
  if (r?.error) return r;
  redirect(`/imports/${id}`);
}

export async function saveMappingAction(id: string, _s: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const columns: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (k.startsWith("col:") && typeof v === "string") columns[k.slice(4)] = v;
    const { preview } = await saveMapping(await requireAuth(), id, { columns, createPossibleDuplicates: form.get("createPossibleDuplicates") });
    revalidatePath(`/imports/${id}`);
    return `Preview updated: ${preview.length} rows checked.`;
  });
}

export async function commitImportAction(id: string, _s: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const job = await commitImport(await requireAuth(), id);
    revalidatePath(`/imports/${id}`);
    return `Imported ${job.acceptedRows} rows; ${job.rejectedRows} not imported.`;
  });
}
