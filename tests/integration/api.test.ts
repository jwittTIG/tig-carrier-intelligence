import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as list from "@/app/api/v1/carriers/route";
import * as one from "@/app/api/v1/carriers/[id]/route";
import { DEV_USER_COOKIE } from "@/server/auth/session";
import { testUser } from "../support/auth";
import { testPrisma } from "../support/db";

const db = testPrisma();
let staffCookie: string;
afterAll(() => db.$disconnect());
beforeAll(async () => {
  const staff = await db.user.findUniqueOrThrow({ where: { email: "demo.producer@example.invalid" } });
  staffCookie = `${DEV_USER_COOKIE}=${staff.id}`;
});

const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(`http://localhost${path}`, { ...init, headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}) } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/v1/carriers", () => {
  it("returns 401 without a session, with a bad cookie, or for a deactivated user", async () => {
    const gone = await testUser(db, { status: "DEACTIVATED" });
    for (const cookie of [undefined, `${DEV_USER_COOKIE}=garbage`, `${DEV_USER_COOKIE}=${randomUUID()}`, `${DEV_USER_COOKIE}=${gone.id}`]) {
      const r = await list.GET(req("/api/v1/carriers", { cookie }));
      expect(r.status).toBe(401);
      expect((await r.json()).error.code).toBe("unauthorized");
    }
    expect((await list.POST(req("/api/v1/carriers", { method: "POST", body: "{}" }))).status).toBe(401);
    const demo = await db.organization.findFirstOrThrow({ where: { displayName: "DEMO Summit Mutual" } });
    expect((await one.GET(req(`/api/v1/carriers/${demo.id}`), params(demo.id))).status).toBe(401);
    expect((await one.PATCH(req(`/api/v1/carriers/${demo.id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) }), params(demo.id))).status).toBe(401);
  });

  it("returns 403 for a signed-in user with no role", async () => {
    const noRole = await testUser(db, { role: null });
    const r = await list.GET(req("/api/v1/carriers", { cookie: `${DEV_USER_COOKIE}=${noRole.id}` }));
    expect(r.status).toBe(403);
  });

  it("lists with pagination, creates (201), validates (400), and 404s unknown ids", async () => {
    const r = await list.GET(req("/api/v1/carriers?q=DEMO&pageSize=2", { cookie: staffCookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ page: 1, pageSize: 2 });
    expect(body.items.length).toBeLessThanOrEqual(2);

    const bad = await list.POST(req("/api/v1/carriers", { method: "POST", cookie: staffCookie, body: JSON.stringify({ type: "INSURER" }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(["legalName", "displayName"]));

    const n = randomUUID().slice(0, 8);
    const created = await list.POST(req("/api/v1/carriers", { method: "POST", cookie: staffCookie, body: JSON.stringify({ legalName: `TEST API ${n} Co`, displayName: `TEST API ${n}`, type: "MGA" }) }));
    expect(created.status).toBe(201);
    const { id } = await created.json();

    const patched = await one.PATCH(req(`/api/v1/carriers/${id}`, { method: "PATCH", cookie: staffCookie, body: JSON.stringify({ status: "PROSPECT", archived: true }) }), params(id));
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ status: "PROSPECT", archivedAt: expect.any(String) });

    const missing = randomUUID();
    expect((await one.GET(req(`/api/v1/carriers/${missing}`, { cookie: staffCookie }), params(missing))).status).toBe(404);
    const agency = await db.organization.findFirstOrThrow({ where: { type: "AGENCY" } });
    expect((await one.GET(req(`/api/v1/carriers/${agency.id}`, { cookie: staffCookie }), params(agency.id))).status).toBe(404);
  });

  it("carrier responses carry no commission or agency-code fields", async () => {
    const demo = await db.organization.findFirstOrThrow({ where: { displayName: "DEMO Summit Mutual" } });
    const r = await one.GET(req(`/api/v1/carriers/${demo.id}`, { cookie: staffCookie }), params(demo.id));
    const text = await r.text();
    expect(text).not.toMatch(/commission|rate|codeValue|agreement/i);
  });
});
