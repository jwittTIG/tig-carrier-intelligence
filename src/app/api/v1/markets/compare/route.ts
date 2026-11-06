import { apiHandler } from "@/server/http";
import { compareMarkets } from "@/server/services/compare";

/** GET /api/v1/markets/compare?<Market Finder filters>&pick=<key>&pick=<key> (2 to 4 keys from /api/v1/markets results). */
export const GET = apiHandler(async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  return Response.json(await compareMarkets(ctx, { ...Object.fromEntries(sp), pick: sp.getAll("pick") }));
});
