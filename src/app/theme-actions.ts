"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/server/auth/session";
import { ACCENT_COOKIE, normalizeHex } from "@/lib/theme";

/** Saves the staff member's accent color in this browser (a cookie; nothing is stored in the database). */
export async function setAccentAction(hex: string): Promise<{ ok: boolean }> {
  await requireAuth();
  const value = normalizeHex(hex);
  if (!value) return { ok: false };
  (await cookies()).set(ACCENT_COOKIE, value, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
  return { ok: true };
}
