import { apiHandler } from "@/server/http";
import { removeKeyword } from "@/server/services/industries";

/** DELETE /api/v1/industry-keywords/:id — needs appetite.write. */
export const DELETE = apiHandler<{ id: string }>(async (_req, ctx, { id }) => {
  await removeKeyword(ctx, id);
  return new Response(null, { status: 204 });
});
