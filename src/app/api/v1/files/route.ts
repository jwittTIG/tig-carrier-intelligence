import { storage, verifyToken } from "@/server/storage";

/**
 * GET /api/v1/files?t=<signed token> — serves a stored file for the dev storage driver.
 * The signed, expiring token is the authorization; it is only issued after a permission
 * check in /api/v1/document-versions/:id/download.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const p = verifyToken(token);
  if (!p) return Response.json({ error: { code: "link_expired", message: "This download link is invalid or has expired." } }, { status: 403 });
  try {
    const bytes = await storage().get(p.key);
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": p.type,
        "content-disposition": `attachment; filename="${p.name.replace(/["\\r\n]/g, "_")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: { code: "not_found", message: "File not found." } }, { status: 404 });
  }
}
