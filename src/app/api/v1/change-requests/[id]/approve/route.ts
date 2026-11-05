import { apiHandler, jsonBody } from "@/server/http";
import { decide } from "@/server/services/approvals";

/** POST /api/v1/change-requests/:id/approve  { rationale? } (required when approving your own, admins only) */
export const POST = apiHandler<{ id: string }>(async (req, ctx, { id }) => {
  const body = (await jsonBody(req)) as { rationale?: string };
  return Response.json(await decide(ctx, id, { decision: "APPROVE", rationale: body?.rationale }));
});
