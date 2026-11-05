import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/http";
import { addSchedule, getAgreement, schedulesCsv } from "@/server/services/commissions";
import { parse } from "@/server/validation";

/** GET /api/v1/commission-schedules?agreementId=&format=csv  (needs commission.read; CSV without agreementId = all) */
export const GET = apiHandler(async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const agreementId = sp.get("agreementId") || undefined;
  if (agreementId) parse(z.uuid(), agreementId);
  if (sp.get("format") === "csv") {
    return new Response(await schedulesCsv(ctx, agreementId), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="commission-schedules-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
    });
  }
  if (!agreementId) return Response.json({ error: { code: "validation_error", message: "agreementId is required for JSON" } }, { status: 400 });
  return Response.json((await getAgreement(ctx, agreementId)).schedules);
});

/** POST /api/v1/commission-schedules  { agreementId, productId, transactionType, basis, ratePercent?, flatAmount?, effectiveFrom, ... } → DRAFT */
export const POST = apiHandler(async (req, ctx) => {
  const body = (await jsonBody(req)) as Record<string, unknown>;
  const agreementId = parse(z.uuid({ error: "agreementId is required" }), body?.agreementId ?? "");
  return Response.json(await addSchedule(ctx, agreementId, body), { status: 201 });
});
