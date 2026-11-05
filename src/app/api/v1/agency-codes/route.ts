import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/http";
import { addAgencyCode, codesCsv, listAgencyCodes } from "@/server/services/appointments";
import { parse } from "@/server/validation";

/** GET /api/v1/agency-codes?q=&organizationId=&assignedUserId=&state=&format=csv */
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

/** POST /api/v1/agency-codes  { appointmentId, codeType, codeValue, effectiveFrom, effectiveTo?, assignedUserId?, status?, notes? } */
export const POST = apiHandler(async (req, ctx) => {
  const body = (await jsonBody(req)) as Record<string, unknown>;
  const appointmentId = parse(z.uuid({ error: "appointmentId is required" }), body?.appointmentId ?? "");
  return Response.json(await addAgencyCode(ctx, appointmentId, body), { status: 201 });
});
