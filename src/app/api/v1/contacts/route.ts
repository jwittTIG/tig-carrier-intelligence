import { apiHandler, jsonBody } from "@/server/http";
import { createContact, listContacts } from "@/server/services/contacts";

/** GET /api/v1/contacts?q=&organizationId=&role=&stateCode=&lineId=&freshness=&page=&pageSize= */
export const GET = apiHandler(async (req, ctx) => Response.json(await listContacts(ctx, Object.fromEntries(new URL(req.url).searchParams))));

/** POST /api/v1/contacts  { firstName, lastName, email?, officePhone?, mobilePhone?, status? } */
export const POST = apiHandler(async (req, ctx) => Response.json(await createContact(ctx, await jsonBody(req)), { status: 201 }));
