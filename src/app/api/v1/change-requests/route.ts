import { z } from "zod";
import { apiHandler, jsonBody } from "@/server/http";
import { submitProfile } from "@/server/services/appetite";
import { listQueue } from "@/server/services/approvals";
import { submitAgreement, submitSchedule } from "@/server/services/commissions";
import { parse } from "@/server/validation";

/** GET /api/v1/change-requests — pending queue and recent decisions. */
export const GET = apiHandler(async (_req, ctx) => Response.json(await listQueue(ctx)));

const submitSchema = z.discriminatedUnion("recordType", [
  z.object({ recordType: z.literal("APPETITE_PROFILE"), recordId: z.uuid(), note: z.string().optional() }),
  z.object({ recordType: z.literal("COMMISSION_AGREEMENT"), recordId: z.uuid(), note: z.string().optional() }),
  z.object({ recordType: z.literal("COMMISSION_SCHEDULE"), recordId: z.uuid(), agreementId: z.uuid(), note: z.string().optional() }),
]);

/** POST /api/v1/change-requests  { recordType, recordId, agreementId? (schedules), note? } — submit a draft for approval. */
export const POST = apiHandler(async (req, ctx) => {
  const b = parse(submitSchema, await jsonBody(req));
  const res =
    b.recordType === "APPETITE_PROFILE" ? await submitProfile(ctx, b.recordId, { note: b.note })
    : b.recordType === "COMMISSION_AGREEMENT" ? await submitAgreement(ctx, b.recordId, { note: b.note })
    : await submitSchedule(ctx, b.agreementId, b.recordId, { note: b.note });
  return Response.json(res, { status: 201 });
});
