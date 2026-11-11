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
  expect(await page.locator("#drawer-portals").evaluate((el) => (el as HTMLElement).inert)).toBe(true);
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

test("pick a carrier in the Carrier contacts tab and see its contacts; one panel open at a time", async ({ page }) => {
  const name = `E2E Contacts ${Date.now()}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/carriers/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.goto(`${page.url().split("?")[0]}?tab=contacts`);
  await page.getByLabel("Type of contact").selectOption({ label: "Claims adjuster" });
  await page.getByLabel("First name").fill("Robin");
  await page.getByLabel("Last name").fill("E2E");
  await page.getByLabel("Email").fill("robin.e2e@example.invalid");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText("Added Robin E2E.")).toBeVisible();

  await page.goto("/dashboard");
  const contactsTab = page.getByRole("button", { name: "Carrier contacts", exact: true });
  const portalsTab = page.getByRole("button", { name: "Carrier portals", exact: true });
  await contactsTab.click();
  await expect(contactsTab).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("complementary", { name: "Carrier contacts" });
  await panel.getByLabel("Carrier").selectOption({ label: name });
  await expect(panel.getByRole("link", { name: "Robin E2E" })).toBeVisible();
  await expect(panel.getByText("Claims adjuster")).toBeVisible();
  await expect(panel.getByRole("link", { name: "robin.e2e@example.invalid" })).toHaveAttribute("href", "mailto:robin.e2e@example.invalid");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // Opening the portals panel closes the contacts one.
  await portalsTab.click();
  await expect(portalsTab).toHaveAttribute("aria-expanded", "true");
  await expect(contactsTab).toHaveAttribute("aria-expanded", "false");
});
