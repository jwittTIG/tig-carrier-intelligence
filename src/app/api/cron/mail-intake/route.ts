import { timingSafeEqual } from "node:crypto";
import { runIntake } from "@/server/services/inbox";

/**
 * Scheduled mailbox check (e.g. Vercel Cron every 15 minutes). Not a user route: it needs
 * `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET set, it is disabled.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = !!secret && secret.length >= 32 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return Response.json({ error: { code: "unauthorized", message: "Not allowed." } }, { status: 401 });
  const r = await runIntake(null);
  return Response.json({ added: r.added, duplicates: r.duplicates, held: r.held, errors: r.errors.length }, { status: r.errors.length && !r.added ? 502 : 200 });
}
