import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { IndustryCodeSystem } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit";
import { queryStems, titleMatches } from "@/lib/industry-words";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parse } from "@/server/validation";
import { parseIndustries } from "./appetite";

/**
 * Industry lookup by code or by words ("roofing" → NAICS 238160 Roofing Contractors).
 * Titles come from the Census Bureau's 2022 NAICS list (industry_codes, seeded).
 * Only NAICS has titles; other systems (SIC, ISO GL…) are still entered as codes.
 * Staff can add extra search words to a code (industry_keywords), e.g. "hvac" → 238220;
 * a code matches when every word appears in its title or its search words.
 */

export type IndustryChoice = { classificationSystem: IndustryCodeSystem; code: string; title: string; level: number; keywords: string[] };
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
  const rows = await prisma.industryCode.findMany({
    where: { classificationSystem: "NAICS", OR: [{ title: { contains: fragment, mode: "insensitive" } }, { keywords: { some: { keyword: { contains: fragment.toLowerCase() } } } }] },
    select: { classificationSystem: true, code: true, title: true, level: true, keywords: { select: { keyword: true }, orderBy: { keyword: "asc" } } },
  });
  return rows
    .map((r) => ({ ...r, keywords: r.keywords.map((k) => k.keyword) }))
    .filter((c) => titleMatches([c.title, ...c.keywords].join(" ; "), stems))
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

// ───────────────────────────── Search words ─────────────────────────────

const codeRef = z.object({ classificationSystem: z.literal("NAICS"), code: z.string().regex(/^\d{2}(-\d{2})?\d{0,4}$/) });
const keywordSchema = z.object({
  keyword: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().min(2, "Enter at least 2 characters").max(60, "Keep it under 60 characters").regex(/^[a-z0-9][a-z0-9 &'.-]*$/, "Use letters, numbers, spaces, & ' . or -")),
});

/** One industry code with its title and search words. */
export async function getIndustry(ctx: AuthContext, classificationSystem: string, code: string) {
  assertCan(ctx, "appetite.read");
  const ref = codeRef.safeParse({ classificationSystem, code });
  if (!ref.success) throw new NotFoundError("Industry code not found.");
  const row = await prisma.industryCode.findUnique({
    where: { classificationSystem_code: ref.data },
    include: { keywords: { orderBy: { keyword: "asc" }, include: { createdBy: { select: { name: true } } } } },
  });
  if (!row) throw new NotFoundError("Industry code not found.");
  // Parent groups (2381, 238…) and, for a group, its industries one level down.
  const parents = row.level > 2 ? await prisma.industryCode.findMany({ where: { classificationSystem: "NAICS", code: { in: Array.from({ length: row.level - 2 }, (_, i) => row.code.slice(0, i + 2)) } }, orderBy: { level: "asc" } }) : [];
  const children = row.level < 6 ? await prisma.industryCode.findMany({ where: { classificationSystem: "NAICS", level: row.level + 1, code: { startsWith: row.code } }, orderBy: { code: "asc" } }) : [];
  return { ...row, parents, children };
}

export async function addKeyword(ctx: AuthContext, classificationSystem: string, code: string, input: unknown) {
  assertCan(ctx, "appetite.write");
  const ref = codeRef.safeParse({ classificationSystem, code });
  if (!ref.success) throw new NotFoundError("Industry code not found.");
  const { keyword } = parse(keywordSchema, input);
  const clean = keyword.replace(/\s+/g, " ");
  try {
    return await prisma.$transaction(async (tx) => {
      const industry = await tx.industryCode.findUnique({ where: { classificationSystem_code: ref.data } });
      if (!industry) throw new NotFoundError("Industry code not found.");
      const row = await tx.industryKeyword.create({ data: { ...ref.data, keyword: clean, createdById: ctx.userId } });
      await recordAudit(tx, ctx, { action: "industry.keyword.add", entityType: "industry_keyword", entityId: row.id, after: { ...row, title: industry.title } });
      return row;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictError(`"${clean}" is already a search word for NAICS ${code}.`);
    throw e;
  }
}

export async function removeKeyword(ctx: AuthContext, id: string) {
  assertCan(ctx, "appetite.write");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Search word not found.");
  return prisma.$transaction(async (tx) => {
    const row = await tx.industryKeyword.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Search word not found.");
    await tx.industryKeyword.delete({ where: { id } });
    await recordAudit(tx, ctx, { action: "industry.keyword.remove", entityType: "industry_keyword", entityId: id, before: row });
    return row;
  });
}
