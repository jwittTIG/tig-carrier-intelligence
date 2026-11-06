import { apiHandler, jsonBody } from "@/server/http";
import { addKeyword } from "@/server/services/industries";

/** POST /api/v1/industries/NAICS/238220/keywords {"keyword":"hvac"} — needs appetite.write. */
export const POST = apiHandler<{ system: string; code: string }>(async (req, ctx, { system, code }) =>
  Response.json(await addKeyword(ctx, system, decodeURIComponent(code ?? ""), await jsonBody(req)), { status: 201 }),
);
