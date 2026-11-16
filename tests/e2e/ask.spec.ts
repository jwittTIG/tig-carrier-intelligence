import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { makePdf } from "../support/pdf";

/**
 * Ask the guides (M8) with the labeled development reader (AI_DRIVER=dev on the test server):
 * upload a guide under a carrier, ask about it, see the verdict, the quote and the page link.
 */
test("upload a guide, ask about the carrier, and see the cited answer", async ({ page }) => {
  const name = `E2E Ask ${Date.now()}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.goto("/carriers/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByRole("checkbox", { name: "Personal Homeowners", exact: true }).check(); // lines are required for an insurer
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("link", { name: "Documents", exact: true }).nth(1).click();
  await page.getByLabel("Title").fill(`${name} homeowners guide`);
  await page.getByLabel("Type").selectOption("UNDERWRITING_GUIDELINES");
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "guide.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf([["Eligibility overview"], ["Roof requirements", "Wood shake roofs are prohibited on all dwellings."]])) });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Uploaded.")).toBeVisible();

  await page.getByRole("link", { name: "Ask the guides" }).click();
  await expect(page.getByText(/Development reader \(AI_DRIVER=dev\)/)).toBeVisible();
  await page.getByLabel("Question").fill(`Will ${name} write a home with a wood shake roof?`);
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page.getByRole("heading", { name: `Will ${name} write a home with a wood shake roof?` })).toBeVisible();
  await expect(page.getByText("No, per the guide")).toBeVisible();
  await expect(page.getByText("“Wood shake roofs are prohibited on all dwellings.”")).toBeVisible();
  const cite = page.getByRole("link", { name: new RegExp(`${name} homeowners guide v1, page 2`) });
  await expect(cite).toHaveAttribute("href", /\/download\?view=1#page=2$/);
  // Answered the cheap way (page text); the costly whole-PDF check is one click away.
  await expect(page.getByText(/Read from the guides.* page text \(every page\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Check the full guide" })).toBeVisible();
  await expect(page.getByText(/not a coverage commitment or approved appetite/).first()).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // The full-guide check reads the whole PDF and answers again, without the button this time.
  await page.getByRole("button", { name: "Check the full guide" }).click();
  await expect(page.getByText(/whole PDF/)).toBeVisible();
  await expect(page.getByText("No, per the guide")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check the full guide" })).toHaveCount(0);

  // It's listed under recent questions.
  await page.getByRole("link", { name: "← Ask the guides" }).click();
  await expect(page.getByRole("link", { name: `Will ${name} write a home with a wood shake roof?` }).first()).toBeVisible();
});
