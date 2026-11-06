import { expect, test } from "@playwright/test";

/** Staff add a search word ("hvac") to a NAICS code, the Market Finder finds it, then it's removed again. */
test("add a search word to an industry code and find it in the Market Finder", async ({ page }) => {
  const word = `hvac e2e ${Date.now().toString(36)}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Industries", exact: true }).click();
  await page.getByLabel("Words or code").fill("air conditioning");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: "NAICS 238220: Plumbing, Heating, and Air-Conditioning Contractors" }).click();
  await expect(page.getByRole("heading", { name: /NAICS 238220/ })).toBeVisible();
  await page.getByLabel("New search word").fill(word);
  await page.getByRole("button", { name: "Add search word" }).click();
  await expect(page.getByText(`Added "${word}".`)).toBeVisible();

  await page.getByRole("link", { name: "Market Finder" }).click();
  await page.locator('select[name="productId"]').selectOption({ label: "General Liability: DEMO Contractors General Liability" });
  await page.getByLabel("Industry (words or code)").fill(word);
  await page.getByRole("button", { name: "Find markets" }).click();
  await expect(page.getByText("Plumbing, Heating, and Air-Conditioning Contractors")).toBeVisible();
  await expect(page.getByText(/the only six-digit match/)).toBeVisible();

  // Clean up so reruns and the dev data stay tidy.
  await page.goto("/industries/NAICS/238220");
  await page.getByRole("listitem").filter({ hasText: word }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: word })).toHaveCount(0);
});
