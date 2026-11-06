import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { looksLikeCode, searchIndustries } from "@/server/services/industries";
import { Section, inputClass } from "@/components/ui";

export const metadata = { title: "Industry codes" };

export default async function IndustriesPage({ searchParams }: PageProps<"/industries">) {
  const ctx = await requireAuth();
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  let results: Awaited<ReturnType<typeof searchIndustries>> = [];
  let error: string | null = null;
  const code = q && looksLikeCode(q) ? q.replace(/^NAICS[\s:]+/i, "") : null;
  if (q && !code) {
    try {
      results = await searchIndustries(ctx, q, 50);
    } catch (e) {
      if (e instanceof AppError) error = e.message;
      else throw e;
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Industry codes</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        NAICS 2022 titles from the U.S. Census Bureau. Open a code to add search words staff use for it (for example “hvac” for Plumbing, Heating, and Air-Conditioning Contractors), so the Market Finder finds it.
      </p>
      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Words or code
          <input name="q" defaultValue={q} placeholder="air conditioning or 238220" className={inputClass} />
        </label>
        <button type="submit" className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Search</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {code && (
        <p className="text-sm">
          <Link href={`/industries/NAICS/${encodeURIComponent(code)}`} className="text-blue-800 hover:underline dark:text-blue-300">Open NAICS {code}</Link>
        </p>
      )}
      {q && !code && !error && (
        <Section title={`${results.length} ${results.length === 1 ? "match" : "matches"}`}>
          {results.length === 0 ? (
            <p className="text-sm">No title or search word matches. Search for a word in the official title (e.g. “air conditioning”), then add “{q}” as a search word on that code.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {results.map((r) => (
                <li key={r.code}>
                  <Link href={`/industries/NAICS/${r.code}`} className="text-blue-800 hover:underline dark:text-blue-300">NAICS {r.code}: {r.title}</Link>
                  {r.level < 6 && <span className="text-xs text-zinc-600 dark:text-zinc-400"> (broader group)</span>}
                  {r.keywords.length > 0 && <span className="text-xs text-zinc-600 dark:text-zinc-400"> · search words: {r.keywords.join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}
