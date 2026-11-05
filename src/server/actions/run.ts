import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppError } from "@/server/errors";

export type ActionState = { error?: string; ok?: string } | null;

/**
 * Runs a server-action body and turns service errors into a message the form can show.
 * Next.js control-flow errors (redirect, notFound) are re-thrown.
 */
export async function runAction(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await fn();
    return { ok: ok ?? "Saved." };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { error: e.message };
    console.error("[action] unhandled error", e instanceof Error ? e.name : "unknown");
    return { error: "Something went wrong. Nothing was saved." };
  }
}
