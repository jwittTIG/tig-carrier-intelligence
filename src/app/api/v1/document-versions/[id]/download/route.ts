import { apiHandler } from "@/server/http";
import { downloadUrl } from "@/server/services/documents";

/** GET /api/v1/document-versions/:id/download — permission check, then redirect to a 5-minute signed URL. */
export const GET = apiHandler<{ id: string }>(async (req, ctx, { id }) => {
  const url = await downloadUrl(ctx, id);
  return new Response(null, { status: 303, headers: { location: new URL(url, req.url).toString(), "cache-control": "no-store" } });
});
