import { apiHandler } from "@/server/http";
import { downloadUrl } from "@/server/services/documents";

/**
 * GET /api/v1/document-versions/:id/download — permission check, then redirect to a 5-minute
 * signed URL. `?view=1` opens a PDF in the browser (add #page=N to jump to a page).
 */
export const GET = apiHandler<{ id: string }>(async (req, ctx, { id }) => {
  const url = await downloadUrl(ctx, id, { view: new URL(req.url).searchParams.get("view") === "1" });
  return new Response(null, { status: 303, headers: { location: new URL(url, req.url).toString(), "cache-control": "no-store" } });
});
