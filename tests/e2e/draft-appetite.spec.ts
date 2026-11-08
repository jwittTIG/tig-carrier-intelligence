import { expect, test, type Page } from "@playwright/test";

/**
 * M9 with the labeled development reader (AI_DRIVER=dev on the test server): upload a guide,
 * let "AI" draft appetite, review and apply it, approve it, and use it in the Market Finder.
 */
async function signIn(page: Page, who: "DEMO Admin" | "DEMO Producer") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: new RegExp(`Sign in as ${who}`) }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("draft appetite from a guide, review it, approve it, and find markets with it", async ({ page }) => {
  const name = `E2E Draft ${Date.now()}`;
  await signIn(page, "DEMO Producer");
  await page.goto("/carriers/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const carrierUrl = page.url().split("?")[0];

  // It writes homeowners.
  await page.goto(`${carrierUrl}?tab=channels`);
  await page.getByRole("checkbox", { name: "Personal Homeowners", exact: true }).check();
  await page.getByRole("button", { name: "Add lines" }).click();
  await expect(page.getByText("Added Personal Homeowners.")).toBeVisible();

  // Upload its guide.
  await page.goto(`${carrierUrl}?tab=documents`);
  await page.getByLabel("Title").fill(`${name} HO guide`);
  await page.getByLabel("Type").selectOption("UNDERWRITING_GUIDELINES");
  const guide = [
    "EFFECTIVE: 2026-01-01",
    "STATES: TN",
    "ATTR: roof_covering | Roof covering | ENUM | Asphalt shingle,Metal,Wood shake | p8 | Roof covering of wood shakes",
    "RULE: ACCEPTED |  | p3 | Homeowners in Tennessee are eligible.",
    "RULE: PROHIBITED | roof_covering IN Wood shake | p8 | Wood shake roofs are ineligible.",
    "REQ: Required form | Wind/hail endorsement in coastal counties | p6",
  ].map((l) => `% ${l}`).join("\n");
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "guide.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n${guide}\n%%EOF\n`) });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Uploaded.")).toBeVisible();

  // Draft appetite from it (Appetite tab).
  await page.goto(`${carrierUrl}?tab=appetite`);
  await page.getByRole("button", { name: "Draft appetite from this guide" }).click();
  await expect(page.getByRole("heading", { name: /AI draft: Personal Homeowners/ })).toBeVisible();
  await expect(page.getByText("Wood shake roofs are ineligible.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Page 8/ }).first()).toHaveAttribute("href", /view=1#page=8$/);
  // Don't take the requirement.
  await page.getByRole("checkbox", { name: /Wind\/hail endorsement/ }).uncheck();
  await page.getByRole("button", { name: "Create draft from selected" }).click();
  await expect(page.getByText(/Added 2 rules, 1 new risk details, 0 limits and 0 requirements/)).toBeVisible();
  await page.getByRole("link", { name: "Open the appetite draft" }).click();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Waiting for approval").first()).toBeVisible();

  // Someone else approves it.
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "DEMO Admin");
  await page.getByRole("link", { name: "Approvals" }).click();
  const queue = page.locator("section").filter({ has: page.getByRole("heading", { name: /Waiting for approval/ }) });
  await queue.getByRole("listitem").filter({ hasText: name }).first().getByRole("button", { name: "Approve" }).click();
  await expect(queue.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);

  // The Market Finder now answers from the guide.
  await page.getByRole("link", { name: "Market Finder" }).click();
  await page.locator('select[name="productId"]').selectOption({ label: "Personal Homeowners: Personal Homeowners" });
  await page.locator('select[name="stateCode"]').selectOption({ label: "Tennessee" });
  await page.getByRole("button", { name: "Find markets" }).click();
  await page.locator('select[name="a_roof_covering"]').selectOption("Wood shake");
  await page.getByRole("button", { name: "Find markets" }).click();
  const prohibited = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Prohibited/ }) });
  await expect(prohibited.getByRole("link", { name, exact: true })).toBeVisible();
  await page.locator('select[name="a_roof_covering"]').selectOption("Metal");
  await page.getByRole("button", { name: "Find markets" }).click();
  const accepted = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Accepted/ }) });
  await expect(accepted.getByRole("link", { name, exact: true })).toBeVisible();
});
