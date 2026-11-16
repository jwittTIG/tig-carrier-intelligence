import "server-only";

/**
 * A document title read from the file itself (Josh, 2026-11-16: "I don't want to have to type in
 * the name"). For a PDF: its own title if it is a real one, else the largest text on page 1 (the
 * heading). Otherwise, or if nothing usable is found, the file name tidied up.
 */
export async function titleFromFile(name: string, bytes: Uint8Array, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    try {
      const fromPdf = await pdfTitle(bytes);
      if (fromPdf) return fromPdf;
    } catch {
      // Unreadable PDF text: fall back to the file name.
    }
  }
  return titleFromFileName(name);
}

const MAX = 200;
const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s\-–—:|•·]+|[\s\-–—:|•·]+$/g, "").trim();

/** "Travelers_Quantum-Home_2.0 (2026).pdf" → "Travelers Quantum Home 2.0 (2026)". */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").replace(/(?<=\D)-(?=\D)/g, " ");
  return clean(base).slice(0, MAX) || "Untitled document";
}

/** A PDF's own Title, when it is a real title rather than a file name or a word-processor default. */
export function usablePdfTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let t = clean(raw.replace(/^Microsoft (Word|PowerPoint|Excel) - /i, ""));
  if (/\.(docx?|pdf|pptx?|xlsx?|indd|rtf)$/i.test(t)) t = clean(t.replace(/\.[a-z]{2,5}$/i, ""));
  if (t.length < 4 || !/[a-z]{3}/i.test(t)) return null;
  if (/^(untitled|document\d*|title|slide \d+|pdf|new document|print)$/i.test(t)) return null;
  // A file name stored as the title ("tna_pg", "TNH-EG-2026"): one word, or underscores.
  if (!/\s/.test(t) || /_/.test(t)) return null;
  return t.slice(0, MAX);
}

const DATE = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}\b/gi;
const wordsOf = (s: string) => s.split(" ").filter((w) => /[a-z]{2,}/i.test(w)).length;

type Item = { str: string; height: number; y: number; x: number };

/** The page-1 heading: the run of text set in the largest type (ignoring tiny fragments). */
export function headingFromItems(items: Item[]): string | null {
  const words = items.filter((i) => i.str.trim() && i.height > 0);
  if (!words.length) return null;
  const sizes = [...new Set(words.map((i) => Math.round(i.height * 2) / 2))].sort((a, b) => b - a);
  for (const size of sizes.slice(0, 3)) {
    // Text at this size, grouped into lines from the top (PDF y grows upward), dates removed.
    const run = words.filter((i) => Math.abs(i.height - size) <= 0.75).sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: { y: number; text: string }[] = [];
    for (const i of run) {
      const line = lines.find((l) => Math.abs(l.y - i.y) < size * 0.6);
      if (line) line.text += ` ${i.str}`;
      else lines.push({ y: i.y, text: i.str });
    }
    const usable = lines.map((l) => ({ y: l.y, text: clean(l.text.replace(DATE, " ")) })).filter((l) => wordsOf(l.text) >= 1);
    if (!usable.length) continue;
    let text = usable[0].text;
    // A title that wraps onto a second line right below.
    const next = usable[1];
    if (next && wordsOf(text) < 4 && usable[0].y - next.y < size * 1.8) text = `${text} ${next.text}`;
    if (wordsOf(text) < 2) continue;
    if (text.length >= 4 && text.length <= MAX * 1.5) return text.slice(0, MAX);
  }
  return null;
}

async function pdfTitle(bytes: Uint8Array): Promise<string | null> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  {
    const meta = await pdf.getMetadata().catch(() => null);
    const own = usablePdfTitle((meta?.info as { Title?: unknown } | undefined)?.Title);
    if (own) return own;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; height?: number; transform?: number[] }[])
      .filter((i) => typeof i.str === "string")
      .map((i) => ({ str: i.str!, height: i.height ?? Math.abs(i.transform?.[3] ?? 0), y: i.transform?.[5] ?? 0, x: i.transform?.[4] ?? 0 }));
    const heading = headingFromItems(items);
    await pdf.cleanup();
    return heading;
  }
}
