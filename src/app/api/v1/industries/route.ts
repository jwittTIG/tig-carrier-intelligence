import { apiHandler } from "@/server/http";
import { searchIndustries } from "@/server/services/industries";

/** GET /api/v1/industries?q=roofing — NAICS 2022 codes whose title matches the words. */
export const GET = apiHandler(async (req, ctx) => Response.json({ items: await searchIndustries(ctx, new URL(req.url).searchParams.get("q") ?? "") }));
