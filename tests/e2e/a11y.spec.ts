import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility check (PRD target WCAG 2.2 AA): no serious or critical axe violations on the
 * primary screens. axe catches roughly a third of WCAG issues; this is not a full audit.
 */
const PAGES = ["/dashboard", "/markets", "/carriers", "/contacts", "/codes", "/documents", "/approvals", "/imports", "/admin/users", "/admin/audit", "/search?q=DEMO"];

test("primary screens have no serious or critical accessibility violations", async ({ page }) => {
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
