import { apiHandler } from "@/server/http";
import { findMarkets } from "@/server/services/market";

/** GET /api/v1/markets?lineId=|productId=&stateCode=&industry=&limit=&includeIntermediaries= — Market Finder. */
export const GET = apiHandler(async (req, ctx) => Response.json(await findMarkets(ctx, Object.fromEntries(new URL(req.url).searchParams))));
