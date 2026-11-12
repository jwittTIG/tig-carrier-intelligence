import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** "Main contacts" (Josh, 2026-11-12): marketing rep, claims and billing at a glance. */
const axeCheck = async (page: Page) => {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
};

test.afterEach(async ({ page }) => {
  await page.waitForLoadState("networkidle");
});

test("Main contacts on the carrier's Contacts tab and the Contacts page, in light, dark and phone layouts", async ({ page, context, baseURL }) => {
  const name = `E2E Main ${Date.now()}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/carriers/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const carrierUrl = page.url().split("?")[0];

  // Nothing on file yet: every row says so.
  await page.goto(`${carrierUrl}?tab=contacts`);
  const card = page.getByRole("region", { name: "Main contacts" });
  await expect(card.getByText("No marketing rep on file")).toBeVisible();
  await expect(card.getByText("No claims contact on file")).toBeVisible();
  await expect(card.getByText("No billing contact on file")).toBeVisible();

  // Add a marketing rep and a claims adjuster.
  for (const [type, first, email] of [["Marketing rep", "Morgan", "morgan.main@example.invalid"], ["Claims adjuster", "Casey", "casey.main@example.invalid"]] as const) {
    await page.getByLabel("Type of contact").selectOption({ label: type });
    await page.getByLabel("First name").fill(first);
    await page.getByLabel("Last name").fill("E2E");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByText(`Added ${first} E2E.`)).toBeVisible();
  }
  await page.reload();
  await expect(card.getByRole("link", { name: "Morgan E2E" })).toBeVisible();
  await expect(card.getByRole("link", { name: "morgan.main@example.invalid" })).toHaveAttribute("href", "mailto:morgan.main@example.invalid");
  await expect(card.getByRole("link", { name: "Casey E2E" })).toBeVisible();
  await expect(card.getByText("Claims adjuster")).toBeVisible();
  await expect(card.getByText("No billing contact on file")).toBeVisible();
  await axeCheck(page);

  // The Contacts page, filtered to the carrier, shows the same card.
  await page.goto("/contacts");
  await expect(page.getByRole("region", { name: /^Main contacts/ })).toHaveCount(0);
  await page.locator('form[role="search"] select[name="organizationId"]').selectOption({ label: name });
  await page.getByRole("button", { name: "Search" }).click();
  const filtered = page.getByRole("region", { name: `Main contacts: ${name}` });
  await expect(filtered.getByRole("link", { name: "Morgan E2E" })).toBeVisible();
  await expect(filtered.getByText("No billing contact on file")).toBeVisible();

  // Dark mode and a phone-width screen.
  await context.addCookies([{ name: "tci-mode", value: "dark", url: baseURL! }]);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await axeCheck(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(filtered.getByRole("link", { name: "Casey E2E" })).toBeVisible();
  const box = (await filtered.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(390); // stacks; nothing runs off the screen
  await axeCheck(page);
});
