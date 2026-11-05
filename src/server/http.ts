import "server-only";
import { contextFromRequest } from "@/server/auth/session";
import type { AuthContext } from "@/server/auth/context";
import { AppError, UnauthorizedError } from "@/server/errors";

type Handler<P> = (req: Request, ctx: AuthContext, params: P) => Promise<Response>;

/**
 * Wraps a versioned API handler: 401 without a session, maps service errors to JSON,
 * and never leaks internal error details.
 */
export function apiHandler<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: Request, route?: { params: Promise<P> }): Promise<Response> => {
    try {
      const ctx = await contextFromRequest(req);
      if (!ctx) throw new UnauthorizedError();
      const params = route ? await route.params : ({} as P);
      return await handler(req, ctx, params);
    } catch (e) {
      if (e instanceof AppError) {
        const issues = "issues" in e ? (e as { issues?: unknown }).issues : undefined;
        return Response.json({ error: { code: e.code, message: e.message, ...(issues ? { issues } : {}) } }, { status: e.status });
      }
      console.error("[api] unhandled error", e instanceof Error ? e.name : "unknown");
      return Response.json({ error: { code: "internal_error", message: "Something went wrong." } }, { status: 500 });
    }
  };
}

export async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
