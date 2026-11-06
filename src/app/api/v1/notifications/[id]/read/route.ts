import { apiHandler } from "@/server/http";
import { markRead } from "@/server/services/notifications";

/** POST /api/v1/notifications/:id/read — someone else's notification is 404. */
export const POST = apiHandler<{ id: string }>(async (_req, ctx, { id }) => {
  await markRead(ctx, id);
  return new Response(null, { status: 204 });
});
