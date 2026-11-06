import { apiHandler } from "@/server/http";
import { listInbox } from "@/server/services/inbox";

/** GET /api/v1/inbox?status=NEW|TRIAGED|DISMISSED|HELD&organizationId=&q= */
export const GET = apiHandler(async (req, ctx) => Response.json(await listInbox(ctx, Object.fromEntries(new URL(req.url).searchParams))));
