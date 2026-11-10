import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Dashboard: the slide-out "Carrier portals" tab with a link to each carrier's sign-in page. */
test("open the carrier portals tab on the Dashboard and find a carrier's sign-in link", async ({ page }) => {
  const name = `E2E Portal ${Date.now()}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/carriers/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByLabel("Carrier portal site").fill("https://agents.example.invalid/login");
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await page.goto("/dashboard");
  const tab = page.getByRole("button", { name: "Carrier portals", exact: true });
  await expect(tab).toHaveAttribute("aria-expanded", "false");
  // Closed: the links can't be reached by keyboard or screen reader.
  expect(await page.locator("#portal-drawer").evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-expanded", "true");
  const link = page.getByRole("link", { name: `${name} portal (opens in a new tab)` });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://agents.example.invalid/login");
  await expect(link).toHaveAttribute("target", "_blank");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(tab).toHaveAttribute("aria-expanded", "false");
  await expect(tab).toBeFocused();
});
