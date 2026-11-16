import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** New carrier: the lines it writes are required, grouped into personal and commercial (Josh, 2026-11-16). */
test("adding an insurer needs at least one line; lines are grouped personal and commercial", async ({ page }) => {
  const name = `E2E NewCarrier ${Date.now()}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/carriers/new");
  const personal = page.getByRole("group", { name: "Personal lines" });
  const commercial = page.getByRole("group", { name: "Commercial lines" });
  await expect(personal.getByRole("checkbox", { name: "Personal Auto", exact: true })).toBeVisible();
  await expect(commercial.getByRole("checkbox", { name: "General Liability", exact: true })).toBeVisible();
  await expect(personal.getByRole("checkbox", { name: "General Liability", exact: true })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByText(/Pick at least one line this carrier writes/)).toBeVisible();

  await personal.getByRole("checkbox", { name: "Personal Auto", exact: true }).check();
  await commercial.getByRole("checkbox", { name: "Commercial Auto", exact: true }).check();
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByRole("link", { name: "Writing companies & channels" }).click();
  await expect(page.getByRole("checkbox", { name: "Personal Auto (added)" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Commercial Auto (added)" })).toBeDisabled();

  // Line dropdowns are grouped too (Market Finder).
  await page.goto("/markets");
  const groups = await page.locator('select[name="lineId"] optgroup').evaluateAll((els) => els.map((e) => e.getAttribute("label")));
  expect(groups).toEqual(["Personal lines", "Commercial lines"]);
});
