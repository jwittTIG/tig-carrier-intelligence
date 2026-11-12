import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility check (PRD target WCAG 2.2 AA): no serious or critical axe violations on the
 * primary screens. axe catches roughly a third of WCAG issues; this is not a full audit.
 */
const PAGES = ["/dashboard", "/markets", "/carriers", "/contacts", "/documents", "/approvals", "/imports", "/admin/users", "/admin/audit", "/search?q=DEMO", "/inbox", "/notifications", "/setup/industries?q=roofing", "/setup/industries/NAICS/238160", "/setup", "/ask"];

// TIG theme (2026-11-11 redesign): light and dark (chosen with the top-bar toggle, a cookie),
// the sidebar collapsed to icons, and a phone-width screen.
for (const { name, mode, sidebar, phone } of [
  { name: "light", mode: "light", sidebar: "open", phone: false },
  { name: "dark", mode: "dark", sidebar: "open", phone: false },
  { name: "light, sidebar collapsed", mode: "light", sidebar: "collapsed", phone: false },
  { name: "dark, phone width", mode: "dark", sidebar: "open", phone: true },
] as const) {
  test(`primary screens have no serious or critical accessibility violations (${name})`, async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: "tci-mode", value: mode, url: baseURL! },
      { name: "tci-sidebar", value: sidebar, url: baseURL! },
    ]);
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Sign in as DEMO Admin/ }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const problems: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      for (const v of r.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
        problems.push(`${path}: ${v.id} (${v.impact}) — ${v.help} [${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}]`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

test("the theme toggle switches to dark and back, and the choice survives page changes", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.getByRole("link", { name: "Carriers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Carriers", level: 1 })).toBeVisible();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
});

test("the sidebar collapses to icons and stays that way", async ({ page, context }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Sign in as DEMO Producer/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const wide = (await sidebar.boundingBox())!.width;
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(wide / 2);
  // Saved in this browser before reloading.
  await expect.poll(async () => (await context.cookies()).find((c) => c.name === "tci-sidebar")?.value).toBe("collapsed");
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  // Collapsed links keep their names for screen readers.
  await expect(page.getByRole("link", { name: "Carriers", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(wide - 4);
});
