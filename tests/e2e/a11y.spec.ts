import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility check (PRD target WCAG 2.2 AA): no serious or critical axe violations on the
 * primary screens. axe catches roughly a third of WCAG issues; this is not a full audit.
 */
const PAGES = ["/dashboard", "/markets", "/carriers", "/contacts", "/codes", "/documents", "/approvals", "/imports", "/admin/users", "/admin/audit", "/search?q=DEMO", "/inbox", "/notifications", "/industries?q=roofing", "/industries/NAICS/238160"];

// Light and dark mode, and a light and a dark custom accent color (shades are derived from the pick).
for (const { scheme, accent } of [
  { scheme: "light", accent: null },
  { scheme: "dark", accent: null },
  { scheme: "light", accent: "#ffff00" },
  { scheme: "dark", accent: "#1e1b4b" },
] as const) {
  test(`primary screens have no serious or critical accessibility violations (${scheme}${accent ? `, accent ${accent}` : ""})`, async ({ page, context, baseURL }) => {
    await page.emulateMedia({ colorScheme: scheme });
    if (accent) await context.addCookies([{ name: "tci-accent", value: accent, url: baseURL! }]);
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
