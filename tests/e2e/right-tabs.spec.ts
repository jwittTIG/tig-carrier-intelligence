import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Dashboard (Josh, 2026-11-11): Ask the guides and Find a market boxes, and stacked menus on
 * the right (Carrier portals, Carrier contacts) that open downward when clicked.
 */
async function signInAndCreateCarrier(page: Page, name: string, portal?: string) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/carriers/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  if (portal) await page.getByLabel("Carrier portal site").fill(portal);
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

const axeCheck = async (page: Page) => {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
};

test("Carrier portals menu opens downward with a carrier's sign-in link", async ({ page }) => {
  const name = `E2E Portal ${Date.now()}`;
  await signInAndCreateCarrier(page, name, "https://agents.example.invalid/login");
  await page.goto("/dashboard");
  const menu = page.getByRole("button", { name: /^Carrier portals/ });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  const link = page.getByRole("link", { name: `${name} portal (opens in a new tab)` });
  await expect(link).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://agents.example.invalid/login");
  await expect(link).toHaveAttribute("target", "_blank");
  await axeCheck(page);
  await menu.click();
  await expect(link).toBeHidden();
});

test("Carrier contacts menu: pick a carrier and see its contacts; both menus can be open", async ({ page }) => {
  const name = `E2E Contacts ${Date.now()}`;
  await signInAndCreateCarrier(page, name);
  await page.goto(`${page.url().split("?")[0]}?tab=contacts`);
  await page.getByLabel("Type of contact").selectOption({ label: "Claims adjuster" });
  await page.getByLabel("First name").fill("Robin");
  await page.getByLabel("Last name").fill("E2E");
  await page.getByLabel("Email").fill("robin.e2e@example.invalid");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText("Added Robin E2E.")).toBeVisible();

  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^Carrier portals/ }).click();
  const contacts = page.getByRole("button", { name: /^Carrier contacts/ });
  await contacts.click();
  await expect(contacts).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: /^Carrier portals/ })).toHaveAttribute("aria-expanded", "true");
  const quick = page.getByRole("complementary", { name: "Quick links" });
  await quick.getByLabel("Carrier", { exact: true }).selectOption({ label: name });
  await expect(quick.getByRole("link", { name: "Robin E2E" })).toBeVisible();
  await expect(quick.getByText("Claims adjuster")).toBeVisible();
  await expect(quick.getByRole("link", { name: "robin.e2e@example.invalid" })).toHaveAttribute("href", "mailto:robin.e2e@example.invalid");
  await axeCheck(page);
});

test("Dashboard boxes: ask the guides and find a market", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const find = page.locator("section").filter({ has: page.getByRole("heading", { name: "Find a market" }) });
  await find.getByLabel("Line").selectOption({ label: "Personal Homeowners" });
  await find.getByLabel("State").selectOption({ label: "Tennessee" });
  await find.getByRole("button", { name: "Find markets" }).click();
  await expect(page.getByRole("heading", { name: "Market Finder" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("stateCode")).toBe("TN");
  expect(new URL(page.url()).searchParams.get("lineId")).toBeTruthy();

  await page.goto("/dashboard");
  const ask = page.locator("section").filter({ has: page.getByRole("heading", { name: "Ask the guides" }) });
  await expect(ask.getByLabel("Question")).toBeVisible();
  await ask.getByLabel("Question").fill("Who writes thatched roofs?");
  await ask.getByRole("button", { name: "Ask" }).click();
  // No carrier named or picked: the form says so instead of guessing.
  await expect(ask.getByText(/Which carrier\?/)).toBeVisible();
});
