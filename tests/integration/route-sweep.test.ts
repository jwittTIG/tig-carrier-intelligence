import { describe, expect, it } from "vitest";

/**
 * Permission regression sweep: every API route under /api/v1 answers 401 to a request with no
 * session, for every HTTP method it exports. The signed-file route is the one exception: its
 * signed token is the authorization, so a missing token gives 403.
 * New routes are picked up automatically.
 */
const routes = import.meta.glob("../../src/app/api/v1/**/route.ts");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const ID = "11111111-1111-4111-8111-111111111111";

describe("every /api/v1 route requires a session", () => {
  it("finds the routes", () => {
    expect(Object.keys(routes).length).toBeGreaterThanOrEqual(20);
  });

  for (const [file, load] of Object.entries(routes)) {
    const path = file.replace(/^.*src\/app/, "").replace(/\/route\.ts$/, "").replace(/\[[^\]]+\]/g, ID);
    it(path, async () => {
      const mod = (await load()) as Record<string, (req: Request, ctx?: unknown) => Promise<Response>>;
      const exported = METHODS.filter((m) => typeof mod[m] === "function");
      expect(exported.length).toBeGreaterThan(0);
      for (const m of exported) {
        const req = new Request(`http://localhost${path}`, { method: m, ...(m === "GET" ? {} : { body: "{}", headers: { "content-type": "application/json" } }) });
        const res = await mod[m](req, { params: Promise.resolve({ id: ID }) });
        const expected = path === "/api/v1/files" ? 403 : path === "/api/health" ? 200 : 401;
        expect(res.status, `${m} ${path}`).toBe(expected);
      }
    });
  }
});
