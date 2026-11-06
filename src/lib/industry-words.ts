/**
 * Word matching for industry titles: "roofer", "roofing" and "roofers" all find
 * "Roofing Contractors". A light suffix stripper (not a full stemmer) plus prefix matching.
 * Pure functions, no database.
 */

const STOP = new Set(["and", "of", "the", "for", "in", "a", "an", "to", "or", "except", "other", "all", "&"]);

// Longest suffixes first. Each strips only if at least 3 letters remain.
const SUFFIXES: [string, string][] = [
  ["icians", "ic"], ["ician", "ic"], ["ical", "ic"],
  ["ings", ""], ["ing", ""], ["ers", ""], ["er", ""], ["ies", "y"], ["ied", "y"], ["es", ""], ["ed", ""], ["s", ""],
];

export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[’']s$/, "").replace(/[^a-z0-9]/g, "");
  for (const [suffix, repl] of SUFFIXES) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, -suffix.length) + repl;
      // shipping → shipp → ship
      if (!repl && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss)$/.test(w)) w = w.slice(0, -1);
      break;
    }
  }
  return w;
}

/** Search words from a query, stemmed, without stop words. */
export function queryStems(q: string): string[] {
  return [...new Set(q.split(/[\s,;/()-]+/).filter((w) => w && !STOP.has(w.toLowerCase())).map(stem).filter((s) => s.length >= 2))];
}

/** True when every query stem starts a word of the title. */
export function titleMatches(title: string, stems: string[]): boolean {
  const words = title.split(/[\s,;/()-]+/).filter(Boolean).map(stem);
  return stems.length > 0 && stems.every((q) => words.some((w) => w.startsWith(q)));
}
