import { expect, test } from "@playwright/test";

/** Josh's 2026-11-10 carrier page changes: fixed name with an Edit button, logo, identifier and contact type lists. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("carrier overview: fixed name, edit on request, logo, identifier and contact types", async ({ page }) => {
  const name = `E2E Page ${Date.now()}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/carriers/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Legal name").fill(`${name} Insurance Company`);
  await page.getByRole("checkbox", { name: "Personal Homeowners", exact: true }).check(); // lines are required for an insurer
  await page.getByRole("button", { name: "Create carrier" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // The carrier opens on the service card; Details is under More (Josh, 2026-11-16).
  await page.getByText("More", { exact: true }).click(); // managing the carrier is under More
  await page.getByRole("link", { name: "Details" }).click();

  // Details are read-only until "Edit details".
  await expect(page.getByLabel("Display name")).toHaveCount(0);
  await page.getByRole("link", { name: "Edit details" }).click();
  await page.getByLabel("Display name").fill(`${name} Renamed`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} Renamed` })).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveCount(0);

  // Logo.
  await page.getByLabel("Image").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Upload logo" }).click();
  await expect(page.getByText("Logo saved.")).toBeVisible();
  const logo = page.getByRole("img", { name: `${name} Renamed logo` });
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // Identifier type from a list.
  await page.locator("#idType").selectOption({ label: "AM Best" });
  await page.getByLabel("Value").fill("E2E-12345");
  await page.getByRole("button", { name: "Add identifier" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "E2E-12345" })).toContainText("AM Best");

  // A contact with a type, added right on the carrier's Contacts tab.
  await page.getByRole("link", { name: "Contacts", exact: true }).nth(1).click();
  await page.getByLabel("Type of contact").selectOption({ label: "Middle market underwriter" });
  await page.getByLabel("First name").fill("Sam");
  await page.getByLabel("Last name").fill("E2E");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText("Added Sam E2E.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Middle market underwriter" })).toBeVisible();
});
