import { apiHandler, jsonBody } from "@/server/http";
import { decide } from "@/server/services/approvals";

/** POST /api/v1/change-requests/:id/reject  { rationale } */
export const POST = apiHandler<{ id: string }>(async (req, ctx, { id }) => {
  const body = (await jsonBody(req)) as { rationale?: string };
  return Response.json(await decide(ctx, id, { decision: "REJECT", rationale: body?.rationale }));
});
