import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// Clerk only establishes the session here. Authorization happens where data is read:
// pages and actions call requireAuth(), API routes use apiHandler(), and every service
// checks a permission. No path matching decides access.
const clerk = process.env.AUTH_DRIVER === "clerk" ? clerkMiddleware() : null;

export function proxy(req: NextRequest, event: NextFetchEvent) {
  return clerk ? clerk(req, event) : NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
