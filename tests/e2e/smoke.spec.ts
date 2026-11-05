import { expect, test } from "@playwright/test";

test("health endpoint and home page respond", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "TIG Carrier Intelligence" })).toBeVisible();
});
