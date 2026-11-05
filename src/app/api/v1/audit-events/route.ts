import { apiHandler } from "@/server/http";
import { listAuditEvents } from "@/server/services/audit-log";

/** GET /api/v1/audit-events?entityType=&action=&actorId=&entityId=&from=&to=&page=&pageSize= (needs audit.read) */
export const GET = apiHandler(async (req, ctx) => Response.json(await listAuditEvents(ctx, Object.fromEntries(new URL(req.url).searchParams))));
