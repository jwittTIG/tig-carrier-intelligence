import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, who: "DEMO Admin" | "DEMO Producer") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: new RegExp(`Sign in as ${who}`) }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/carriers");
  await expect(page.getByRole("heading", { name: "Carriers" })).toBeVisible();
}

test("upload a guide, draft appetite, submit, and have someone else approve it", async ({ page }) => {
  const name = `E2E Appetite ${Date.now()}`;
  await signIn(page, "DEMO Producer");

  // A fresh carrier with one product, so reruns never collide.
  await page.getByRole("link", { name: "New carrier" }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("link", { name: "Writing companies & channels" }).click();
  const productLabel = (await page.getByLabel("Existing product").locator("option").nth(1).textContent())!.trim();
  await page.getByLabel("Existing product").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  // File the appetite guide under the carrier.
  await page.getByRole("link", { name: "Documents", exact: true }).nth(1).click();
  await page.getByLabel("Title").fill(`${name} guide`);
  await page.getByLabel("Type").selectOption("APPETITE_GUIDE");
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "guide.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% E2E appetite guide\n%%EOF\n") });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Uploaded.")).toBeVisible();
  await expect(page.getByRole("link", { name: `${name} guide` })).toBeVisible();

  // Draft a profile with one rule and a source, then submit.
  await page.getByRole("link", { name: "Appetite", exact: true }).click();
  await page.getByLabel("Effective from (optional)").fill("2026-01-01");
  await page.getByRole("button", { name: "Start appetite profile" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("v1");
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await page.getByText("Add a rule").click();
  await page.getByLabel("Outcome").selectOption("ACCEPTED");
  await page.getByLabel("States (leave empty for all)").selectOption({ label: "Tennessee" });
  await page.getByLabel("Industry codes (optional)").fill("NAICS 238160");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Rule added.")).toBeVisible();
  await page.getByLabel("Document", { exact: true }).selectOption({ label: `${name} guide v1` });
  await page.getByLabel("Page or section").fill("p. 2");
  await page.getByRole("button", { name: "Add source" }).click();
  await expect(page.getByText("Source added.")).toBeVisible();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Waiting for approval").first()).toBeVisible();
  await expect(page.getByText("Someone else needs to review it.")).toBeVisible();
  const profileUrl = page.url();

  // Someone else approves it from the queue.
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "DEMO Admin");
  await page.getByRole("link", { name: "Approvals" }).click();
  const queue = page.locator("section").filter({ has: page.getByRole("heading", { name: /Waiting for approval/ }) });
  const item = queue.getByRole("listitem").filter({ hasText: name }).first();
  await item.getByRole("button", { name: "Approve" }).click();
  // Once decided, it leaves the queue.
  await expect(queue.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
  await page.goto(profileUrl);
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Confirmed · next review/)).toBeVisible();

  // And it shows up in the Market Finder for a TN roofing contractor.
  await page.getByRole("link", { name: "Market Finder" }).click();
  await page.locator('select[name="productId"]').selectOption({ label: productLabel });
  await page.locator('select[name="stateCode"]').selectOption({ label: "Tennessee" });
  await page.getByLabel("Industry code").fill("NAICS 238160");
  await page.getByRole("button", { name: "Find markets" }).click();
  const accepted = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Accepted/ }) });
  await expect(accepted.getByRole("link", { name })).toBeVisible();
  await expect(page.getByText(/not a commitment to quote or bind/).first()).toBeVisible();
});
