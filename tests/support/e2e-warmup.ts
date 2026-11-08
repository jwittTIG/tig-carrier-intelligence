/**
 * Playwright global setup: the freshly started test server compiles each page on first use,
 * which can outlast the first test's timeouts. Load the main pages once before any test runs.
 */
export default async function warmup() {
  const base = "http://localhost:3100";
  for (const path of ["/sign-in", "/dashboard", "/carriers", "/markets", "/ask"]) {
    try {
      await fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
    } catch {
      // A slow or failed warm-up is not a test failure; the tests will show any real problem.
    }
  }
}
