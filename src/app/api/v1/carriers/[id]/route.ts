import { z } from "zod";
import { parse } from "@/server/validation";
import { apiHandler, jsonBody } from "@/server/http";
import { getCarrier, setCarrierArchived, updateCarrier } from "@/server/services/carriers";

type Params = { id: string };

/** GET /api/v1/carriers/:id — carrier with identifiers, relationships, products and channels. */
export const GET = apiHandler<Params>(async (_req, ctx, { id }) => Response.json(await getCarrier(ctx, id)));

/** PATCH /api/v1/carriers/:id  { ...fields, archived?: boolean } */
export const PATCH = apiHandler<Params>(async (req, ctx, { id }) => {
  const body = (await jsonBody(req)) as Record<string, unknown>;
  const { archived, ...fields } = body ?? {};
  if (Object.keys(fields).length) await updateCarrier(ctx, id, fields);
  if (archived !== undefined) await setCarrierArchived(ctx, id, parse(z.boolean(), archived));
  return Response.json(await getCarrier(ctx, id));
});
