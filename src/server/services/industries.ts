import { IndustryCodeSystem } from "@/generated/prisma/enums";
import { queryStems, titleMatches } from "@/lib/industry-words";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { parseIndustries } from "./appetite";

/**
 * Industry lookup by code or by words ("roofing" → NAICS 238160 Roofing Contractors).
 * Titles come from the Census Bureau's 2022 NAICS list (industry_codes, seeded).
 * Only NAICS has titles; other systems (SIC, ISO GL…) are still entered as codes.
 */

export type IndustryChoice = { classificationSystem: IndustryCodeSystem; code: string; title: string; level: number };
export type ResolvedIndustry =
  | { kind: "code"; classificationSystem: IndustryCodeSystem; code: string; title: string | null; matchedWords: string | null }
  | { kind: "choices"; query: string; choices: IndustryChoice[] };

const SYSTEMS = Object.values(IndustryCodeSystem) as string[];

/** "238160", "NAICS 238160", "ISO_GL 91111" are codes; anything else is words. */
export function looksLikeCode(text: string): boolean {
  const t = text.trim();
  if (/^\d{2,6}$/.test(t)) return true;
  const m = t.match(/^([A-Za-z_]+)[\s:]+(\S+)$/);
  return !!m && SYSTEMS.includes(m[1].toUpperCase().replace(/^ISO$/, "ISO_GL")) && /\d/.test(m[2]);
}

/** NAICS codes whose title contains all the words. Most specific (6-digit) and shortest titles first. */
export async function searchIndustries(ctx: AuthContext, q: string, take = 20): Promise<IndustryChoice[]> {
  assertCan(ctx, "appetite.read");
  const stems = queryStems(q.slice(0, 100));
  if (!stems.length || stems.every((s) => s.length < 3)) throw new ValidationError("Enter at least 3 letters of an industry, e.g. roofing.");
  // Narrow in the database with the longest word, then match every word here.
  // One letter shorter so "bakery" (from "bakeries") still finds "Bakeries".
  const longest = [...stems].sort((a, b) => b.length - a.length)[0];
  const fragment = longest.slice(0, Math.max(3, longest.length - 1));
  const candidates = await prisma.industryCode.findMany({
    where: { classificationSystem: "NAICS", title: { contains: fragment, mode: "insensitive" } },
    select: { classificationSystem: true, code: true, title: true, level: true },
  });
  return candidates
    .filter((c) => titleMatches(c.title, stems))
    .sort((a, b) => b.level - a.level || a.title.split(" ").length - b.title.split(" ").length || a.code.localeCompare(b.code))
    .slice(0, Math.min(take, 50));
}

export async function industryTitle(classificationSystem: IndustryCodeSystem, code: string): Promise<string | null> {
  const row = await prisma.industryCode.findUnique({ where: { classificationSystem_code: { classificationSystem, code } }, select: { title: true } });
  return row?.title ?? null;
}

/**
 * Turns what staff typed into one industry code, or a list to choose from.
 * Words use a code only when exactly one 6-digit NAICS industry matches; otherwise staff choose.
 */
export async function resolveIndustry(ctx: AuthContext, text: string): Promise<ResolvedIndustry> {
  const t = text.trim();
  if (looksLikeCode(t)) {
    const parsed = parseIndustries(/^\d{2,6}$/.test(t) ? `NAICS ${t}` : t)[0];
    return { kind: "code", ...parsed, title: await industryTitle(parsed.classificationSystem, parsed.code), matchedWords: null };
  }
  const choices = await searchIndustries(ctx, t);
  if (!choices.length) throw new ValidationError(`No NAICS industry matches "${t}". Try another word (e.g. roofing, restaurant, trucking) or enter a code.`);
  const national = choices.filter((c) => c.level === 6);
  if (national.length === 1) return { kind: "code", classificationSystem: "NAICS", code: national[0].code, title: national[0].title, matchedWords: t };
  return { kind: "choices", query: t, choices };
}
