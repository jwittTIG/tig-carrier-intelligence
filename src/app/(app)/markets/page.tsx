import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { listLines, listProducts } from "@/server/services/carriers";
import { listTerritories } from "@/server/services/contacts";
import { findMarkets } from "@/server/services/market";
import { OutcomeBadge } from "@/components/m4";
import { Badge, Section, fmtDate, inputClass, label } from "@/components/ui";

export const metadata = { title: "Market Finder" };

const GROUP_TITLE: Record<string, string> = {
  PREFERRED: "Preferred",
  ACCEPTED: "Accepted",
  REFERRAL: "Refer to underwriter",
  PROHIBITED: "Prohibited / declines",
  UNKNOWN: "Unknown: no stated appetite for this risk",
};

export default async function MarketsPage({ searchParams }: PageProps<"/markets">) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const [lines, products, territories] = await Promise.all([listLines(ctx), listProducts(ctx), listTerritories(ctx)]);
  const asked = !!(params.lineId || params.productId);
  let result: Awaited<ReturnType<typeof findMarkets>> | null = null;
  let error: string | null = null;
  if (asked) {
    try {
      result = await findMarkets(ctx, params);
    } catch (e) {
      if (e instanceof AppError) error = e.message;
      else throw e;
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Market Finder</h1>
      <form method="get" role="search" className="grid grid-cols-1 gap-3 rounded border border-zinc-200 bg-white p-3 sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-700 dark:bg-zinc-900">
        <label className="flex flex-col gap-1 text-sm">
          Line
          <select name="lineId" defaultValue={params.lineId ?? ""} className={inputClass}>
            <option value="">—</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          or product
          <select name="productId" defaultValue={params.productId ?? ""} className={inputClass}>
            <option value="">—</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.line.name}: {p.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          State
          <select name="stateCode" defaultValue={params.stateCode ?? ""} className={inputClass}>
            <option value="">Any</option>
            {territories.filter((t) => t.stateCode).map((t) => <option key={t.id} value={t.stateCode!}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Industry code
          <input name="industry" defaultValue={params.industry} placeholder="NAICS 238160" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Limit wanted ($)
          <input name="limit" defaultValue={params.limit} inputMode="decimal" placeholder="2,000,000" className={inputClass} />
        </label>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includeIntermediaries" defaultChecked={params.includeIntermediaries !== "false" && (params.includeIntermediaries === "on" || !asked)} />Include wholesalers/MGAs</label>
          <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Find markets</button>
        </div>
      </form>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!asked && <p className="text-sm text-zinc-600 dark:text-zinc-400">Choose a line or product to start. Add a state and an industry code to narrow it down.</p>}

      {result && (
        <>
          <p role="note" className="rounded border border-zinc-300 bg-zinc-100 p-2 text-sm dark:border-zinc-600 dark:bg-zinc-800">{result.disclaimer}</p>
          <p className="text-xs text-zinc-500">
            Only approved appetite in effect today is used. Rules for a specific class only count when you enter an industry code.
            Conditions such as revenue limits are shown for you to check; they are not evaluated.
          </p>
          {result.total === 0 && <p className="text-sm">No carrier products are recorded for this line.</p>}
          {result.groups.filter((g) => g.results.length).map((g) => (
            <Section key={g.outcome} title={`${GROUP_TITLE[g.outcome]} (${g.results.length})`}>
              <ul className="flex flex-col gap-3">
                {g.results.map((r) => (
                  <li key={r.key} className="flex flex-col gap-1 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/carriers/${r.carrier.id}`} className="font-medium text-blue-800 hover:underline dark:text-blue-300">{r.carrier.displayName}</Link>
                      <span>· {r.product} · {r.channel}</span>
                      <OutcomeBadge outcome={r.outcome} />
                      {r.appointed ? <Badge tone="good">Appointed</Badge> : <Badge tone="warn">No current appointment</Badge>}
                      {r.stale && <Badge tone="warn">Appetite review overdue</Badge>}
                      {r.conflicting && <Badge tone="bad">Conflicting rules: check</Badge>}
                      {r.limit.state === "BELOW" && <Badge tone="bad">Limit too low</Badge>}
                    </div>
                    <div className="text-zinc-600 dark:text-zinc-400">
                      {r.profileId ? (
                        <Link href={`/appetite/${r.profileId}`} className="hover:underline">Appetite v{r.version}</Link>
                      ) : "No appetite profile"}
                      {r.profileId && <> · {r.sources} {r.sources === 1 ? "source" : "sources"} · next review {fmtDate(r.nextReviewAt)}</>}
                      {r.note && <> · {r.note}</>}
                    </div>
                    {r.matchedRules.length > 0 && (
                      <ul className="text-xs">
                        {r.matchedRules.map((m) => <li key={m.id}>{label(m.outcome)}: {m.scope}{m.rationale && ` · “${m.rationale}”`}</li>)}
                      </ul>
                    )}
                    {r.conditions.length > 0 && (
                      <ul className="text-xs text-amber-800 dark:text-amber-300">
                        {r.conditions.map((c, i) => <li key={i}>Check: {c.text} → {label(c.outcome)}</li>)}
                      </ul>
                    )}
                    <div className="text-xs">Limits: {r.limit.text}</div>
                    {r.contacts.length > 0 && (
                      <div className="text-xs">
                        Contacts:{" "}
                        {r.contacts.map((c, i) => (
                          <span key={c.id}>{i > 0 && "; "}<Link href={`/contacts/${c.id}`} className="hover:underline">{c.name}</Link> ({label(c.role)}){c.email && ` ${c.email}`}{c.phone && ` ${c.phone}`}</span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </>
      )}
    </>
  );
}
