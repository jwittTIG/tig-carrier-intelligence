import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/server/db/client";
import { authDriver, DEV_USER_COOKIE } from "./session";

/**
 * DEVELOPMENT-ONLY sign-in: choose a seeded user. Every function refuses unless
 * AUTH_DRIVER=dev, and authDriver() itself refuses AUTH_DRIVER=dev in production.
 */
function assertDev() {
  if (authDriver() !== "dev") throw new Error("Development sign-in is disabled");
}

export async function devSignInUsers() {
  assertDev();
  return prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, roleScopes: { select: { role: { select: { code: true } } } } },
  });
}

export async function devSignIn(userId: string) {
  assertDev();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (user?.status !== "ACTIVE") throw new Error("Unknown or inactive user");
  (await cookies()).set(DEV_USER_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function devSignOut() {
  assertDev();
  (await cookies()).delete(DEV_USER_COOKIE);
}
