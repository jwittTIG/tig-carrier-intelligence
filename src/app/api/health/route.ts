import { checkDatabase } from "@/server/services/health";

/** Liveness + database check. Public by design; returns no data beyond up/down. */
export async function GET() {
  const db = await checkDatabase();
  return Response.json(
    { status: db.ok ? "ok" : "degraded", database: db.ok ? "ok" : "unavailable" },
    { status: db.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
