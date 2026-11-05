import { apiHandler, jsonBody } from "@/server/http";
import { createCarrier, listCarriers } from "@/server/services/carriers";

/** GET /api/v1/carriers?q=&type=&status=&ownerUserId=&parentId=&lineId=&includeArchived=&page=&pageSize= */
export const GET = apiHandler(async (req, ctx) => {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return Response.json(await listCarriers(ctx, params));
});

/** POST /api/v1/carriers  { legalName, displayName, type, status?, parentId?, ownerUserId?, website? } */
export const POST = apiHandler(async (req, ctx) => {
  const carrier = await createCarrier(ctx, await jsonBody(req));
  return Response.json(carrier, { status: 201 });
});
