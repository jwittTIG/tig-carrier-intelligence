import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Upload a guide on the Appetite tab, no name typed, and have AI draft from it right away (Josh, 2026-11-16). */
test.afterEach(async ({ page }) => {
  await page.waitForLoadState("networkidle");
});

test("upload a guide on the Appetite tab; its name comes from the file and the AI read starts", async ({ page }) => {
  const name = `E2E Upload ${Date.now()}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/carriers/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const carrierUrl = page.url().split("?")[0];
  await page.goto(`${carrierUrl}?tab=channels`);
  await page.getByRole("checkbox", { name: "Personal Homeowners", exact: true }).check();
  await page.getByRole("button", { name: "Add lines" }).click();
  await expect(page.getByText("Added Personal Homeowners.")).toBeVisible();

  await page.goto(`${carrierUrl}?tab=appetite`);
  const upload = page.locator("#upload-guide");
  await expect(upload.getByLabel("Title")).toHaveCount(0); // no name to type
  await expect(upload.getByLabel("Product it covers")).toHaveValue(/.+/); // the only line is picked
  await expect(upload.getByLabel(/Draft appetite from it now/)).toBeChecked();
  const guide = ["STATES: TN", "RULE: PROHIBITED |  | p4 | Vacant dwellings are ineligible."].map((l) => `% ${l}`).join("\n");
  await upload.getByLabel("Guide (PDF)").setInputFiles({ name: "Homeowners_guide.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n${guide}\n%%EOF\n`) });
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText(`Uploaded “${name} – Homeowners guide”. AI is reading it now`)).toBeVisible();

  // The read runs after the upload; the guide's line says when it's ready.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Ready for review")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: `${name} – Homeowners guide v1` })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await page.getByRole("link", { name: "Review the AI draft" }).click();
  await expect(page.getByText("Vacant dwellings are ineligible.").first()).toBeVisible();
});
