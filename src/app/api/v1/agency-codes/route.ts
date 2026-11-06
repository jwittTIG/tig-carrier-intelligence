import { apiHandler, jsonBody } from "@/server/http";
import { addAgencyCode, codesCsv, listAgencyCodes } from "@/server/services/appointments";

/** GET /api/v1/agency-codes?q=&organizationId=&assignedUserId=&state=active|inactive&format=csv */
export const GET = apiHandler(async (req, ctx) => {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const { format, ...filters } = params;
  const rows = await listAgencyCodes(ctx, filters);
  if (format === "csv") {
    return new Response(codesCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="agency-codes-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  return Response.json(rows);
});

/** POST /api/v1/agency-codes  { marketChannelId, codeType, codeValue, agencyEntityId?, assignedUserId?, notes? } */
export const POST = apiHandler(async (req, ctx) => Response.json(await addAgencyCode(ctx, await jsonBody(req)), { status: 201 }));
