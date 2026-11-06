import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Milestone 7: compare markets for one risk; follow a carrier and get notified (D22, D23). */

async function signIn(page: Page, who: "DEMO Admin" | "DEMO Producer") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: new RegExp(`Sign in as ${who}`) }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("compare two markets side by side for a TN risk", async ({ page }) => {
  await signIn(page, "DEMO Producer");
  await page.getByRole("link", { name: "Market Finder" }).click();
  await page.locator('select[name="productId"]').selectOption({ label: "General Liability: DEMO Contractors General Liability" });
  await page.locator('select[name="stateCode"]').selectOption({ label: "Tennessee" });
  await page.getByRole("button", { name: "Find markets" }).click();
  const boxes = page.getByRole("checkbox", { name: /^Compare / });
  await expect(boxes.first()).toBeVisible();
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole("button", { name: "Compare selected" }).click();
  await expect(page.getByRole("heading", { name: "Compare markets" })).toBeVisible();
  await expect(page.getByText(/not a commitment to quote or bind/).first()).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  for (const row of ["Outcome", "Underwriting requirements", "Agency codes", "Commission in effect", "Contacts"]) {
    await expect(table.getByRole("rowheader", { name: row })).toBeVisible();
  }
  await expect(page.getByText("Risk: TN")).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await page.getByRole("link", { name: "← Back to Market Finder" }).click();
  await expect(page.locator('select[name="stateCode"]')).toHaveValue("TN");
});

test("follow a carrier, then get notified when an email is filed under it", async ({ page }) => {
  await signIn(page, "DEMO Producer");
  await page.goto("/carriers");
  await page.getByRole("link", { name: "DEMO Summit Mutual", exact: true }).click();
  await expect(page.getByRole("heading", { name: "DEMO Summit Mutual" })).toBeVisible();
  if (await page.getByRole("button", { name: "Follow", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Follow", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Unfollow" })).toBeVisible();

  const subject = `E2E notify ${Date.now()}`;
  const dir = path.resolve(".data/inbox");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}-notify.eml`), [
    "From: DEMO Admin <demo.admin@example.invalid>",
    "To: carrier-updates@example.invalid",
    `Subject: ${subject}`,
    `Message-ID: <e2e-notify-${Date.now()}@example.invalid>`,
    "Date: Fri, 06 Nov 2026 15:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "DEMO bulletin for an end-to-end test.",
    "",
  ].join("\r\n"));

  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "DEMO Admin");
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  await page.getByRole("button", { name: "Check mailbox now" }).click();
  await expect(page.getByText(/Checked \d+: \d+ new/)).toBeVisible();
  await page.getByRole("link", { name: subject }).click();
  await page.getByLabel("Carrier", { exact: true }).selectOption({ label: "DEMO Summit Mutual" });
  await page.getByRole("button", { name: "File under carrier" }).click();
  await expect(page.getByText("Filed under the carrier.")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "DEMO Producer");
  await expect(page.getByRole("link", { name: /Notifications, \d+ unread/ })).toBeVisible();
  await page.getByRole("link", { name: /Notifications/ }).click();
  const item = page.getByRole("listitem").filter({ hasText: subject });
  await expect(item).toContainText("New update filed under DEMO Summit Mutual");
  await item.getByRole("button", { name: "Mark read" }).click();
  await expect(item.getByRole("button", { name: "Mark read" })).toHaveCount(0);
});
