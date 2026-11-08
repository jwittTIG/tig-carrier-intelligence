import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Email intake with the dev mailbox: drop an .eml into the e2e mailbox folder (what the test server reads),
 * check the mailbox, file it under a carrier, and start an appetite draft from it.
 */
test("forwarded bulletin → inbox → file under carrier → appetite draft", async ({ page }) => {
  const subject = `E2E Fwd: Roofing appetite ${Date.now()}`;
  const dir = process.env.E2E_INBOX_DIR!;
  fs.mkdirSync(dir, { recursive: true });
  const pdf = Buffer.from("%PDF-1.4\n% E2E bulletin\n%%EOF\n").toString("base64");
  fs.writeFileSync(path.join(dir, `${Date.now()}.eml`), [
    "From: DEMO Producer <demo.producer@example.invalid>",
    "To: carrier-updates@example.invalid",
    `Subject: ${subject}`,
    `Message-ID: <e2e-${Date.now()}@example.invalid>`,
    "Date: Wed, 04 Nov 2026 15:00:00 +0000",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="B"',
    "",
    "--B",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "---------- Forwarded message ---------",
    "From: Demo Underwriter <demo.uw@example.invalid>",
    "",
    "Roofing is now acceptable in TN.",
    "--B",
    'Content-Type: application/pdf; name="Roofing bulletin.pdf"',
    'Content-Disposition: attachment; filename="Roofing bulletin.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    pdf,
    "--B--",
    "",
  ].join("\r\n"));

  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Admin/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("Development mailbox").or(page.getByText(/Forward carrier bulletins/)).first()).toBeVisible();
  await page.getByRole("button", { name: "Check mailbox now" }).click();
  await expect(page.getByText(/Checked \d+: \d+ new/)).toBeVisible();
  await page.getByRole("link", { name: subject }).click();

  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  await expect(page.getByText("Roofing is now acceptable in TN.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Roofing bulletin.pdf" })).toBeVisible();

  await page.getByLabel("Carrier", { exact: true }).selectOption({ label: "DEMO Summit Mutual" });
  await page.getByRole("button", { name: "File under carrier" }).click();
  await expect(page.getByText("Filed under the carrier.")).toBeVisible();

  await page.getByRole("button", { name: "Start appetite draft" }).click();
  await expect(page).toHaveURL(/\/appetite\//);
  await expect(page.getByText("Roofing bulletin.pdf", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
});
