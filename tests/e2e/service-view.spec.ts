import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The service layout (Josh, 2026-11-16): staff see carriers, phones, markets and guides; the
 * admin pages and edit controls appear only with the Admin tools switch on.
 */
test.use({ storageState: { cookies: [], origins: [] } });
test.afterEach(async ({ page }) => {
  await page.waitForLoadState("networkidle");
});

test("service layout by default; Admin tools shows the admin pages and controls", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Admin/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const nav = page.getByRole("navigation").first();
  const adminSwitch = page.getByRole("switch", { name: "Admin tools" });
  await expect(adminSwitch).toHaveAttribute("aria-checked", "false");
  await expect(nav.getByRole("link", { name: "Carriers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Approvals" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Setup" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Carriers you own" })).toHaveCount(0);

  // The carrier page opens on the service card; managing it is under More.
  await page.goto("/carriers");
  await expect(page.getByRole("link", { name: "New carrier" })).toHaveCount(0);
  await page.getByRole("link", { name: "DEMO Summit Mutual", exact: true }).first().click();
  await expect(page.getByRole("link", { name: "Service card" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Claims phone")).toBeVisible();
  await expect(page.getByText("Agency code")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What they write" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit details" })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await page.getByText("More", { exact: true }).click();
  await page.getByRole("link", { name: "Details" }).click();
  await expect(page.getByText("More: Details")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit details" })).toHaveCount(0);

  // Admin tools on: the edit control, approvals and setup appear.
  await adminSwitch.click();
  await expect(page.getByRole("link", { name: "Edit details" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Approvals" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Setup" })).toBeVisible();
  await expect(adminSwitch).toHaveAttribute("aria-checked", "true");
  // And off again.
  await adminSwitch.click();
  await expect(page.getByRole("link", { name: "Approvals" })).toHaveCount(0);
});
