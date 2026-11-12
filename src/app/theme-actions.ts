"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/server/auth/session";
import { MODE_COOKIE, SIDEBAR_COOKIE, modeOf } from "@/lib/theme";

const COOKIE = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };

/** Light or dark, saved in this browser (a cookie; nothing is stored in the database). */
export async function setModeAction(mode: string): Promise<{ ok: boolean }> {
  await requireAuth();
  (await cookies()).set(MODE_COOKIE, modeOf(mode), COOKIE);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Sidebar collapsed to icons or open, saved in this browser. */
export async function setSidebarAction(collapsed: boolean): Promise<{ ok: boolean }> {
  await requireAuth();
  (await cookies()).set(SIDEBAR_COOKIE, collapsed ? "collapsed" : "open", COOKIE);
  return { ok: true };
}
