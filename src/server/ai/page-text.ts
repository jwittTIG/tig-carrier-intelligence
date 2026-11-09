import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { prisma } from "@/server/db/client";
import { storage } from "@/server/storage";

/**
 * Page text of a PDF guide, read once from the stored file (no AI) and saved in
 * document_pages (DECISIONS N23). Scanned pages come back empty: there's no OCR here.
 */

export type PageText = { number: number; text: string };

export class UnreadablePdfError extends Error {}

export async function pagesFor(version: { id: string; objectKey: string; mimeType: string }): Promise<PageText[]> {
  const saved = await prisma.documentPage.findMany({ where: { documentVersionId: version.id }, orderBy: { pageNumber: "asc" } });
  if (saved.length) return saved.map((p) => ({ number: p.pageNumber, text: p.text }));
  if (version.mimeType !== "application/pdf") throw new UnreadablePdfError("Only PDFs can be read page by page.");
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await storage().get(version.objectKey)), { verbosity: 0 });
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch (e) {
    throw new UnreadablePdfError(`Couldn't read text from this PDF (${e instanceof Error ? e.message.slice(0, 120) : "unknown"}).`);
  }
  const rows = pages.map((text, i) => ({ documentVersionId: version.id, pageNumber: i + 1, text: text.replace(/\u0000/g, "").trim() }));
  if (rows.length) await prisma.documentPage.createMany({ data: rows, skipDuplicates: true });
  return rows.map((r) => ({ number: r.pageNumber, text: r.text }));
}
