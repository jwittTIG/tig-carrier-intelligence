import { apiHandler } from "@/server/http";
import { errorReportUrl } from "@/server/services/imports";

/** GET /api/v1/imports/:id/errors — redirect to a 5-minute signed link to the error report. */
export const GET = apiHandler<{ id: string }>(async (req, ctx, { id }) => {
  const url = await errorReportUrl(ctx, id);
  return new Response(null, { status: 303, headers: { location: new URL(url, req.url).toString(), "cache-control": "no-store" } });
});
