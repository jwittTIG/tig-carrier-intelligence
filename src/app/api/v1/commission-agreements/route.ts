import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/http";
import { createAgreement, listAgreementsForCarrier } from "@/server/services/commissions";
import { parse } from "@/server/validation";

/** GET /api/v1/commission-agreements?organizationId=  (needs commission.read) */
export const GET = apiHandler(async (req, ctx) => {
  const organizationId = parse(z.uuid({ error: "organizationId is required" }), new URL(req.url).searchParams.get("organizationId") ?? "");
  return Response.json(await listAgreementsForCarrier(ctx, organizationId));
});

/** POST /api/v1/commission-agreements  { agencyEntityId, marketChannelId, agreementRef?, sourceDocumentVersionId?, contingencyNotes?, notes? } */
export const POST = apiHandler(async (req, ctx) => Response.json(await createAgreement(ctx, await jsonBody(req)), { status: 201 }));
