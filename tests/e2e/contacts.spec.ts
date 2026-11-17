import { expect, test } from "@playwright/test";

test("add a contact, assign them, confirm them, and find them as the rep", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page.getByRole("link", { name: "New contact" }).click();

  const last = `E2E${Date.now()}`;
  await page.getByLabel("First name").fill("Pat");
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Email").fill(`pat.${last.toLowerCase()}@example.invalid`);
  await page.getByRole("button", { name: "Create contact" }).click();
  await expect(page.getByRole("heading", { name: `Pat ${last}` })).toBeVisible();
  await expect(page.getByText("Never confirmed")).toBeVisible();

  await page.getByLabel("Carrier or intermediary").selectOption({ label: "DEMO Summit Mutual" });
  await page.getByLabel("Role").selectOption("UNDERWRITER");
  await page.getByLabel("Territory").selectOption({ label: "Tennessee" });
  await page.getByRole("button", { name: "Add assignment" }).click();
  await expect(page.getByText("Assignment added.")).toBeVisible();

  await page.getByLabel("How did you confirm?").fill("E2E: called the office");
  await page.getByRole("button", { name: "Confirm still current" }).click();
  await expect(page.getByText(/Confirmed · next review/)).toBeVisible();

  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page.locator('form[role="search"] select[name="organizationId"]').selectOption({ label: "DEMO Summit Mutual" });
  await page.locator('form[role="search"] select[name="stateCode"]').selectOption({ label: "Tennessee" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: `Pat ${last}` })).toBeVisible();

  // Codes are looked up on the carrier page (no separate Codes page).
  await page.goto("/carriers");
  await page.getByRole("link", { name: "DEMO Summit Mutual", exact: true }).click();
  await page.getByText("More", { exact: true }).click(); // managing the carrier is under More
  await page.getByRole("link", { name: "Codes & portals" }).click();
  await expect(page.getByText("DEMO-0001").first()).toBeVisible();
});
