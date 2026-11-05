import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/http";
import { createAppointment, listAppointmentsForCarrier } from "@/server/services/appointments";
import { parse } from "@/server/validation";

/** GET /api/v1/appointments?organizationId=  (appointments on that carrier's channels, with codes) */
export const GET = apiHandler(async (req, ctx) => {
  const organizationId = parse(z.uuid({ error: "organizationId is required" }), new URL(req.url).searchParams.get("organizationId") ?? "");
  return Response.json(await listAppointmentsForCarrier(ctx, organizationId));
});

/** POST /api/v1/appointments  { agencyEntityId, marketChannelId, appointmentType, status?, effectiveFrom?, effectiveTo? } */
export const POST = apiHandler(async (req, ctx) => Response.json(await createAppointment(ctx, await jsonBody(req)), { status: 201 }));
