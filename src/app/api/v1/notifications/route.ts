import { apiHandler } from "@/server/http";
import { listNotifications, unreadCount } from "@/server/services/notifications";

/** GET /api/v1/notifications?unread=true — your own notifications only. */
export const GET = apiHandler(async (req, ctx) => {
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "true";
  const [items, unread] = await Promise.all([listNotifications(ctx, { unreadOnly }), unreadCount(ctx)]);
  return Response.json({ unread, items });
});
