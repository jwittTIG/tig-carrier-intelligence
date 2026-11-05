import { apiHandler } from "@/server/http";
import { ValidationError } from "@/server/errors";
import { getImport, saveMapping, uploadImport } from "@/server/services/imports";

/**
 * POST /api/v1/imports/preview
 * multipart: file, targetType, mapping? (JSON {field: header})  → new import job + row-by-row preview
 * or JSON:  { importJobId, columns, createPossibleDuplicates? } → re-preview an existing job
 */
export const POST = apiHandler(async (req, ctx) => {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Send a CSV file.");
    const job = await uploadImport(ctx, { targetType: form.get("targetType") }, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    const mapping = form.get("mapping");
    if (typeof mapping === "string" && mapping) {
      let columns: unknown;
      try {
        columns = JSON.parse(mapping);
      } catch {
        throw new ValidationError("mapping must be JSON.");
      }
      return Response.json(await saveMapping(ctx, job.id, { columns }), { status: 201 });
    }
    const { preview, headers } = await getImport(ctx, job.id);
    return Response.json({ job, headers, preview }, { status: 201 });
  }
  const body = (await req.json().catch(() => ({}))) as { importJobId?: string; columns?: unknown; createPossibleDuplicates?: unknown };
  if (!body.importJobId) throw new ValidationError("importJobId is required.");
  return Response.json(await saveMapping(ctx, body.importJobId, body));
});
