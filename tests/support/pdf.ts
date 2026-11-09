import { PDFDocument, StandardFonts } from "pdf-lib";

/** A real, text-based PDF: one array of lines per page. Fictional content only. */
export async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`TEST ${Math.random()}`); // unique bytes per file
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 16, size: 11, font }));
  }
  return doc.save();
}
