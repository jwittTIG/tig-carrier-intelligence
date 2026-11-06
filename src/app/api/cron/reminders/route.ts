import { timingSafeEqual } from "node:crypto";
import { runReminders } from "@/server/services/notifications";

/**
 * Daily reminders (appointment expiry, appetite review due). Not a user route: it needs
 * `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET set, it is disabled.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = !!secret && secret.length >= 32 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return Response.json({ error: { code: "unauthorized", message: "Not allowed." } }, { status: 401 });
  return Response.json(await runReminders(null));
}
