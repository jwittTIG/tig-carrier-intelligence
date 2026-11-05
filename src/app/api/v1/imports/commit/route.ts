import { apiHandler, jsonBody } from "@/server/http";
import { ValidationError } from "@/server/errors";
import { commitImport } from "@/server/services/imports";

/** POST /api/v1/imports/commit  { importJobId } — creates accepted rows in one transaction. */
export const POST = apiHandler(async (req, ctx) => {
  const body = (await jsonBody(req)) as { importJobId?: string };
  if (!body?.importJobId) throw new ValidationError("importJobId is required.");
  return Response.json(await commitImport(ctx, body.importJobId));
});
