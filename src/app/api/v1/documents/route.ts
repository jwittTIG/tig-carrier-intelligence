import { apiHandler } from "@/server/http";
import { ValidationError } from "@/server/errors";
import { listDocuments, uploadDocument } from "@/server/services/documents";

/** GET /api/v1/documents?q=&documentType=&organizationId= */
export const GET = apiHandler(async (req, ctx) => Response.json(await listDocuments(ctx, Object.fromEntries(new URL(req.url).searchParams))));

/** POST /api/v1/documents  multipart: file, title, documentType, classification?, organizationId? */
export const POST = apiHandler(async (req, ctx) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) throw new ValidationError("Send multipart/form-data with a file.");
  const meta = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const res = await uploadDocument(ctx, meta, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  return Response.json({ document: res.document, version: { ...res.version, sizeBytes: Number(res.version.sizeBytes) } }, { status: 201 });
});
