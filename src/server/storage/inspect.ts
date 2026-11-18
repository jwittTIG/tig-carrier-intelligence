import "server-only";
import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

/** File types accepted for upload, identified by content, not by name. */
export const ALLOWED_TYPES: Record<string, { label: string; ext: string }> = {
  "application/pdf": { label: "PDF", ext: "pdf" },
  "image/png": { label: "PNG image", ext: "png" },
  "image/jpeg": { label: "JPEG image", ext: "jpg" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "Word document", ext: "docx" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { label: "Excel workbook", ext: "xlsx" },
  "text/csv": { label: "CSV", ext: "csv" },
  "text/plain": { label: "Text", ext: "txt" },
  // Original emails from the mailbox (stored by intake, never accepted as uploads: no signature to sniff).
  "message/rfc822": { label: "Email", ext: "eml" },
};

export type Inspection = { ok: true; mimeType: string; sha256: string; sizeBytes: number } | { ok: false; reason: string };

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Checks size and real file type. Text files (CSV/TXT) have no signature, so they must decode as UTF-8. */
export async function inspectUpload(filename: string, bytes: Uint8Array, maxBytes: number): Promise<Inspection> {
  if (bytes.length === 0) return { ok: false, reason: "The file is empty." };
  if (bytes.length > maxBytes) return { ok: false, reason: `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  const sniffed = await fileTypeFromBuffer(bytes);
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  let mimeType: string | undefined = sniffed?.mime;
  if (!sniffed) {
    if ((ext === "csv" || ext === "txt") && isUtf8Text(bytes)) mimeType = ext === "csv" ? "text/csv" : "text/plain";
  }
  if (!mimeType || !ALLOWED_TYPES[mimeType]) {
    return { ok: false, reason: `That file type isn't accepted${sniffed ? ` (${sniffed.mime})` : ""}. Upload a PDF, image, Word, Excel, CSV or text file.` };
  }
  const expectedExt = ALLOWED_TYPES[mimeType].ext;
  const extOk = ext === expectedExt || (mimeType === "image/jpeg" && ext === "jpeg");
  if (!extOk) return { ok: false, reason: `The file's content is ${ALLOWED_TYPES[mimeType].label}, but its name ends in .${ext}. Rename it or upload the right file.` };
  return { ok: true, mimeType, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
}

/**
 * Malware scanning hook. There is no real scanner yet:
 * - development: a stub that only recognizes the EICAR test string;
 * - production: refused unless UPLOAD_SCANNER=none, Josh's decision D24 (2026-11-18): only
 *   signed-in staff upload, and every file's type is checked by content above. Each upload
 *   then records scanner "none (D24)", so unscanned files can be found if a scanner is added.
 */
export async function scanUpload(bytes: Uint8Array, env: { NODE_ENV?: string; UPLOAD_SCANNER?: string } = process.env): Promise<{ clean: boolean; scanner: string }> {
  const text = Buffer.from(bytes.subarray(0, 512)).toString("latin1");
  const eicar = text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
  if (env.NODE_ENV === "production") {
    if (env.UPLOAD_SCANNER !== "none") throw new Error("No malware scanner is configured for production (set UPLOAD_SCANNER=none per DECISIONS D24)");
    return { clean: !eicar, scanner: "none (D24)" };
  }
  return { clean: !eicar, scanner: "dev-stub" };
}
