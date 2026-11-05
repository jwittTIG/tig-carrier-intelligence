import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/http";
import { createProfile, listProfilesForCarrier } from "@/server/services/appetite";
import { parse } from "@/server/validation";

/** GET /api/v1/appetite-profiles?organizationId= */
export const GET = apiHandler(async (req, ctx) => {
  const organizationId = parse(z.uuid({ error: "organizationId is required" }), new URL(req.url).searchParams.get("organizationId") ?? "");
  return Response.json(await listProfilesForCarrier(ctx, organizationId));
});

/** POST /api/v1/appetite-profiles  { carrierProductId, marketChannelId?, effectiveFrom?, ownerUserId? } → new DRAFT */
export const POST = apiHandler(async (req, ctx) => Response.json(await createProfile(ctx, await jsonBody(req)), { status: 201 }));
