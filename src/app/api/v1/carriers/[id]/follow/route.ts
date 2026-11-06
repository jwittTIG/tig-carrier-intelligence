import { apiHandler } from "@/server/http";
import { follow, unfollow } from "@/server/services/notifications";

/** PUT follows the carrier; DELETE unfollows. */
export const PUT = apiHandler<{ id: string }>(async (_req, ctx, { id }) => {
  await follow(ctx, id);
  return new Response(null, { status: 204 });
});

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx, { id }) => {
  await unfollow(ctx, id);
  return new Response(null, { status: 204 });
});
