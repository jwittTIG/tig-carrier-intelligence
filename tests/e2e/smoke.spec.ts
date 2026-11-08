import { expect, test } from "@playwright/test";

// Runs against the dev server and the DEV database with AUTH_DRIVER=dev (seeded DEMO users).

test("health endpoint responds and private pages require sign-in", async ({ page, request }) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await request.get("/api/v1/carriers")).status()).toBe(401);
  await page.goto("/carriers");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByText("Development sign-in.")).toBeVisible();
});

test("sign in, create a carrier, find it, archive it", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("link", { name: "Carriers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Carriers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0); // STAFF is not an admin

  const name = `E2E Carrier ${Date.now()}`;
  await page.getByRole("link", { name: "New carrier" }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByLabel("Type").selectOption("INSURER");
  await page.getByLabel("Carrier portal site").fill("https://agents.example.invalid/login");
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  // The portal site becomes a login button that opens in a new tab.
  const login = page.getByRole("link", { name: /Log in to carrier portal/ });
  await expect(login).toHaveAttribute("href", "https://agents.example.invalid/login");
  await expect(login).toHaveAttribute("target", "_blank");

  await page.getByRole("link", { name: "Change history" }).click();
  await expect(page.getByRole("cell", { name: "carrier.create" })).toBeVisible();

  await page.getByRole("link", { name: "Carriers", exact: true }).first().click();
  await page.getByLabel("Name or identifier").fill(name);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Log in to the ${name} portal`) })).toHaveAttribute("href", "https://agents.example.invalid/login");

  await page.getByRole("link", { name, exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Archive carrier" }).click();
  await expect(page.getByText(/Archived \d{4}-\d{2}-\d{2}/)).toBeVisible();
});
