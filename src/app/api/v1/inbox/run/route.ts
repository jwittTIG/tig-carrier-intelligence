import { apiHandler } from "@/server/http";
import { runIntake } from "@/server/services/inbox";

/** POST /api/v1/inbox/run — check the mailbox now (needs inbox.manage). */
export const POST = apiHandler(async (_req, ctx) => Response.json(await runIntake(ctx)));
