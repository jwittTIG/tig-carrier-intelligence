import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/server/db/client";
import { linkIdentityOnFirstSignIn } from "@/server/services/users";
import { loadAuthContext, type AuthContext } from "./context";

/**
 * Sign-in drivers (DECISIONS D9):
 * - `clerk`: Microsoft 365 sign-in through Clerk. Not tested until the Clerk app exists.
 * - `dev`: DEVELOPMENT ONLY. Pick a seeded user on /sign-in; refuses to run in production
 *   and must be enabled explicitly with AUTH_DRIVER=dev.
 */
export type AuthDriver = "clerk" | "dev";

export const DEV_USER_COOKIE = "tci_dev_user";

export function authDriver(): AuthDriver {
  const driver = process.env.AUTH_DRIVER;
  if (driver === "dev") {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_DRIVER=dev is refused when NODE_ENV=production");
    return "dev";
  }
  if (driver === "clerk") return "clerk";
  throw new Error("AUTH_DRIVER must be set to 'clerk' or 'dev' (see .env.example)");
}

type Resolution = { state: "signed_out" } | { state: "no_access" } | { state: "ok"; ctx: AuthContext };

async function resolveClerk(): Promise<Resolution> {
  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const { userId: subject } = await auth();
  if (!subject) return { state: "signed_out" };
  const known = await prisma.user.findUnique({ where: { identitySubject: subject }, select: { id: true } });
  let userId = known?.id ?? null;
  if (!userId) {
    const cu = await currentUser();
    const primary = cu?.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId);
    if (!primary || primary.verification?.status !== "verified") return { state: "no_access" };
    userId = await linkIdentityOnFirstSignIn(subject, primary.emailAddress);
  }
  const ctx = userId ? await loadAuthContext(userId) : null;
  return ctx ? { state: "ok", ctx } : { state: "no_access" };
}

async function resolveDev(devUserId: string | undefined): Promise<Resolution> {
  if (!devUserId) return { state: "signed_out" };
  const ctx = await loadAuthContext(devUserId).catch(() => null);
  return ctx ? { state: "ok", ctx } : { state: "no_access" };
}

/** Session for pages and server actions. Cached per request. */
export const getSession = cache(async (): Promise<Resolution> => {
  // Wait for a real request: never resolve a session while prerendering at build time.
  await connection();
  if (authDriver() === "dev") return resolveDev((await cookies()).get(DEV_USER_COOKIE)?.value);
  return resolveClerk();
});

/** For pages and server actions: redirects when not signed in or not set up. */
export async function requireAuth(): Promise<AuthContext> {
  const s = await getSession();
  if (s.state === "signed_out") redirect("/sign-in");
  if (s.state === "no_access") redirect("/no-access");
  return s.ctx;
}

function cookieFrom(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** For API route handlers: null means 401. Reads the request directly (testable without Next request scope). */
export async function contextFromRequest(req: Request): Promise<AuthContext | null> {
  const s = authDriver() === "dev" ? await resolveDev(cookieFrom(req, DEV_USER_COOKIE)) : await resolveClerk();
  return s.state === "ok" ? s.ctx : null;
}
