import { queryStems, stem } from "./industry-words";

/**
 * Picks which guide pages to send for a question (DECISIONS N23). Pure functions, no AI.
 * When all pages fit the token budget, all are sent (nothing can be missed). Otherwise pages
 * are ranked by how often they use the question's words (rarer words count more) and the best
 * ones are kept until the budget is used, plus the page after the top hits (rules run on).
 */

export type Page = { number: number; text: string };
export type Guide = { pages: Page[]; title?: string };

const TITLE_STOP = new Set(["guid", "underwrit", "appetit", "manual", "program", "the", "and", "for"]);

/**
 * Over budget, a question that names a guide's line ("auto", "home", "umbrella"...) by a word in
 * its title reads only the guides it names. Words in every title (e.g. the carrier name) don't count.
 */
function guidesNamed(guides: Guide[], question: string): number[] | null {
  const q = new Set(queryStems(question));
  const titleTerms = guides.map((g) => new Set(termsOf(g.title ?? "").filter((t) => t.length >= 3 && !/^\d/.test(t) && !TITLE_STOP.has(t))));
  const named = titleTerms.map((terms, i) => ({ i, hit: [...terms].some((t) => q.has(t) && !titleTerms.every((o) => o.has(t))) })).filter((x) => x.hit).map((x) => x.i);
  return named.length && named.length < guides.length ? named : null;
}

/**
 * Rough token count as the reader is billed. Measured on Travelers' guides with citations on
 * (2026-11-09): 297k characters of page text came to 168k input tokens, ~1.77 characters per
 * token (tables, numbers and citation chunking cost more than prose). 1.6 errs high.
 */
export const tokensOf = (text: string) => Math.ceil(text.length / 1.6);

// Words too common in guides to tell pages apart.
const GUIDE_STOP = new Set(["travel", "will", "write", "risk", "polic", "insur", "coverag", "guid", "eligib", "home", "dwell", "auto", "vehicl"]);

function termsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2).map(stem);
}

export function selectPages(guides: Guide[], question: string, budgetTokens: number): { guide: number; pages: number[] }[] {
  const total = guides.reduce((n, g) => n + g.pages.reduce((m, p) => m + tokensOf(p.text), 0), 0);
  if (total <= budgetTokens) return guides.map((g, i) => ({ guide: i, pages: g.pages.filter((p) => p.text.trim()).map((p) => p.number) }));

  const q = queryStems(question).filter((s) => s.length >= 3 && !GUIDE_STOP.has(s));
  const only = guidesNamed(guides, question);
  const all = guides.flatMap((g, gi) => (only && !only.includes(gi) ? [] : g.pages.map((p) => ({ gi, p, terms: termsOf(p.text) }))));
  const df = new Map(q.map((s) => [s, all.filter((x) => x.terms.some((t) => t.startsWith(s))).length]));
  const n = all.length || 1;
  const scored = all
    .map((x) => {
      let score = 0;
      for (const s of q) {
        const tf = x.terms.filter((t) => t.startsWith(s)).length;
        if (tf) score += (1 + Math.log(tf)) * Math.log(1 + n / (df.get(s) || 1));
      }
      return { ...x, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const chosen = new Map<string, { gi: number; p: Page }>();
  let used = 0;
  const add = (gi: number, p: Page | undefined) => {
    if (!p || !p.text.trim() || chosen.has(`${gi}:${p.number}`)) return true;
    const t = tokensOf(p.text);
    if (used + t > budgetTokens) return false;
    chosen.set(`${gi}:${p.number}`, { gi, p });
    used += t;
    return true;
  };
  // A rule often runs onto the next page: the best hit's next page comes first, then every
  // other matching page, then the next pages of the other strong hits while budget remains.
  const next = (x: (typeof scored)[number]) => guides[x.gi].pages.find((p) => p.number === x.p.number + 1);
  if (scored[0]) {
    add(scored[0].gi, scored[0].p);
    add(scored[0].gi, next(scored[0]));
  }
  for (const x of scored) add(x.gi, x.p);
  for (const x of scored.slice(1, 5)) add(x.gi, next(x));
  return guides.map((_, gi) => ({ guide: gi, pages: [...chosen.values()].filter((c) => c.gi === gi).map((c) => c.p.number).sort((a, b) => a - b) }));
}

/** One plain-text document with page markers, and where each page's text sits in it. */
export function pagesDocument(pages: Page[]): { text: string; spans: { page: number; start: number; end: number }[] } {
  let text = "";
  const spans: { page: number; start: number; end: number }[] = [];
  for (const p of pages) {
    text += `\n\n=== Page ${p.number} ===\n`;
    const start = text.length;
    text += p.text;
    spans.push({ page: p.number, start, end: text.length });
  }
  return { text, spans };
}

/** The page a character position falls on. A position inside a page marker counts as that marker's page. */
export function pageAt(spans: { page: number; start: number; end: number }[], index: number): number {
  return (spans.find((s) => index < s.end) ?? spans[spans.length - 1])?.page ?? 1;
}
