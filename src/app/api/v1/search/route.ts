import { apiHandler } from "@/server/http";
import { globalSearch } from "@/server/services/overview";

/** GET /api/v1/search?q= — carriers, contacts, codes and documents. */
export const GET = apiHandler(async (req, ctx) => Response.json(await globalSearch(ctx, new URL(req.url).searchParams.get("q") ?? "")));
