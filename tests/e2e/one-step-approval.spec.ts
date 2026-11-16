import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Reviewing an AI draft and approving it in one step (Josh, 2026-11-16): rules grouped by outcome
 * with search, "only ones to check" and select all/none; then Create and approve with a reason.
 */
test.afterEach(async ({ page }) => {
  await page.waitForLoadState("networkidle");
});

test("review the AI's rules by group and approve the draft in one step", async ({ page }) => {
  const name = `E2E OneStep ${Date.now()}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Admin/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/carriers/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByRole("checkbox", { name: "Personal Homeowners", exact: true }).check(); // lines are required for an insurer
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const carrierUrl = page.url().split("?")[0];

  await page.goto(`${carrierUrl}?tab=documents`);
  await page.getByLabel("Title").fill(`${name} HO guide`);
  await page.getByLabel("Type").selectOption("UNDERWRITING_GUIDELINES");
  const guide = [
    "EFFECTIVE: 2026-01-01",
    "STATES: TN",
    "RULE: ACCEPTED |  | p3 | Homeowners in Tennessee are eligible.",
    "RULE: PROHIBITED |  | p4 | Vacant dwellings are ineligible.",
    "RULE: PROHIBITED |  | p5 | Dwellings with trampolines are ineligible.",
    "RULE: REFERRAL |  | p6 | Pools maybe refer to underwriting.",
  ].map((l) => `% ${l}`).join("\n");
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "guide.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n${guide}\n%%EOF\n`) });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Uploaded.")).toBeVisible();
  await page.goto(`${carrierUrl}?tab=appetite`);
  await page.getByRole("button", { name: "Draft appetite from this guide" }).click();
  await expect(page.getByRole("heading", { name: /AI draft: Personal Homeowners/ })).toBeVisible();

  // Grouped by outcome, everything ticked to start.
  await expect(page.getByRole("button", { name: /Prohibited 2 of 2 selected/ })).toBeVisible();
  await expect(page.getByText("4 of 4 items selected")).toBeVisible();
  // Only the one the AI is unsure about.
  await page.getByLabel(/Only ones to check \(1\)/).check();
  await expect(page.getByText("Pools maybe refer to underwriting.").first()).toBeVisible();
  await expect(page.getByText("Vacant dwellings are ineligible.").first()).toBeHidden();
  await page.getByLabel(/Only ones to check/).uncheck();
  // Search, then untick a group.
  await page.getByLabel("Find a rule").fill("trampoline");
  await expect(page.getByText("Vacant dwellings are ineligible.").first()).toBeHidden();
  await page.getByLabel("Find a rule").fill("");
  await page.getByRole("button", { name: "None of the Referral rules" }).click();
  await expect(page.getByText("3 of 4 items selected")).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // A reason that's too short is refused, and nothing ticked or unticked is lost.
  await page.getByLabel("Reason for approving (recorded)").fill("ok");
  await page.getByRole("button", { name: "Create and approve" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /reason/ })).toBeVisible();
  await expect(page.getByText("3 of 4 items selected")).toBeVisible();

  // One step: create and approve, with the reason D14 asks for.
  await page.getByLabel("Reason for approving (recorded)").fill("Checked the AI draft page by page against the guide");
  await page.getByRole("button", { name: "Create and approve" }).click();
  await expect(page).toHaveURL(/\/appetite\/[0-9a-f-]+\?done=approved/);
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Rules \(3\)/)).toBeVisible();
});
