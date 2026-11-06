import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { listLines, listProducts } from "@/server/services/carriers";
import { listTerritories } from "@/server/services/contacts";
import { MAX_COMPARE } from "@/server/services/compare";
import { findMarkets, riskAttributesFor } from "@/server/services/market";
import { OutcomeBadge } from "@/components/m4";
import { Badge, Section, fmtDate, inputClass, label } from "@/components/ui";
import { ConditionList, RiskAttributeInputs, firstValues } from "./risk";

export const metadata = { title: "Market Finder" };

const GROUP_TITLE: Record<string, string> = {
  PREFERRED: "Preferred",
  ACCEPTED: "Accepted",
  REFERRAL: "Refer to underwriter",
  NEEDS_INFO: "Needs information: enter the missing risk details",
  PROHIBITED: "Prohibited / declines",
  UNKNOWN: "Unknown: no stated appetite for this risk",
};

export default async function MarketsPage({ searchParams }: PageProps<"/markets">) {
  const ctx = await requireAuth();
  const params = firstValues(await searchParams);
  const [lines, products, territories] = await Promise.all([listLines(ctx), listProducts(ctx), listTerritories(ctx)]);
  const asked = !!(params.lineId || params.productId);
  const attributes = asked ? await riskAttributesFor(ctx, params) : [];
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
  // Carried into the comparison so it uses the same risk.
  const carry = Object.entries(params).filter((e): e is [string, string] => !!e[1] && e[0] !== "pick");
  const withIndustry = (code: string) => `/markets?${new URLSearchParams({ ...Object.fromEntries(carry), industry: `NAICS ${code}` }).toString()}`;

  return (
    <>
      <h1 className="text-xl font-semibold">Market Finder</h1>
      <form method="get" role="search" className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
            Industry (words or code)
            <input name="industry" defaultValue={params.industry} placeholder="roofing or 238160" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Limit wanted ($)
            <input name="limit" defaultValue={params.limit} inputMode="decimal" placeholder="2,000,000" className={inputClass} />
          </label>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includeIntermediaries" defaultChecked={params.includeIntermediaries !== "false" && (params.includeIntermediaries === "on" || !asked)} />Include wholesalers/MGAs</label>
            <button type="submit" className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Find markets</button>
          </div>
        </div>
        <RiskAttributeInputs attributes={attributes} values={params} asked={asked} />
      </form>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {error && params.industry && /No NAICS industry matches/.test(error) && (
        <p className="text-sm">
          Staff call it something the official title doesn&rsquo;t? <Link href="/industries" className="text-blue-800 hover:underline dark:text-blue-300">Find the code</Link> and add “{params.industry}” as a search word.
        </p>
      )}
      {!asked && <p className="text-sm text-zinc-600 dark:text-zinc-400">Choose a line or product to start. Add a state and an industry code to narrow it down.</p>}

      {result && result.industryChoices.length > 0 && (
        <Section title={`Which industry? ${result.industryChoices.length} NAICS ${result.industryChoices.length === 1 ? "match" : "matches"} for “${params.industry}”`}>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Choose the one that describes the risk. Six-digit codes are the most specific; a shorter code covers every industry under it.</p>
          <ul className="flex flex-col gap-1 text-sm">
            {result.industryChoices.map((c) => (
              <li key={c.code}>
                <Link href={withIndustry(c.code)} className="text-blue-800 hover:underline dark:text-blue-300">NAICS {c.code}: {c.title}</Link>
                {c.level < 6 && <span className="text-xs text-zinc-500"> (broader group)</span>}
                {c.keywords.length > 0 && <span className="text-xs text-zinc-600 dark:text-zinc-400"> · search words: {c.keywords.join(", ")}</span>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">Not here? <Link href={`/industries?q=${encodeURIComponent(params.industry ?? "")}`} className="hover:underline">Look up industry codes</Link> and add search words.</p>
        </Section>
      )}

      {result && result.industryChoices.length === 0 && (
        <>
          {result.industry && (
            <p className="text-sm">
              Industry: <strong>{result.industry.classificationSystem} {result.industry.code}</strong>
              {result.industry.title ? ` · ${result.industry.title}` : " · title not on file"}
              {result.industry.matchedWords && <span className="text-zinc-600 dark:text-zinc-400"> (the only six-digit match for “{result.industry.matchedWords}”)</span>}
            </p>
          )}
          <p role="note" className="rounded border border-zinc-300 bg-zinc-100 p-2 text-sm dark:border-zinc-600 dark:bg-zinc-800">{result.disclaimer}</p>
          <p className="text-xs text-zinc-500">
            Only approved appetite in effect today is used. Rules for a specific class only count when you enter an industry.
            Conditions such as revenue limits are checked against the risk details you enter; a missing detail is never treated as acceptable.
          </p>
          {result.total === 0 && <p className="text-sm">No carrier products are recorded for this line.</p>}
          {result.total > 1 && (
            <form id="compare" method="get" action="/markets/compare" className="flex flex-wrap items-center gap-3 text-sm">
              {carry.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <button type="submit" className="rounded border border-zinc-300 bg-white px-3 py-1.5 font-medium hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900">Compare selected</button>
              <span className="text-xs text-zinc-500">Tick 2 to {MAX_COMPARE} markets below.</span>
            </form>
          )}
          {result.groups.filter((g) => g.results.length).map((g) => (
            <Section key={g.outcome} title={`${GROUP_TITLE[g.outcome]} (${g.results.length})`}>
              <ul className="flex flex-col gap-3">
                {g.results.map((r) => (
                  <li key={r.key} className="flex flex-col gap-1 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-700">
                    <div className="flex flex-wrap items-center gap-2">
                      {result.total > 1 && (
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" name="pick" value={r.key} form="compare" />
                          <span className="sr-only">Compare {r.carrier.displayName} {r.product} {r.channel}</span>
                        </label>
                      )}
                      <Link href={`/carriers/${r.carrier.id}`} className="font-medium text-blue-800 hover:underline dark:text-blue-300">{r.carrier.displayName}</Link>
                      <span>· {r.product} · {r.channel}</span>
                      {r.group === "NEEDS_INFO" ? <Badge tone="warn">Needs information</Badge> : <OutcomeBadge outcome={r.outcome} />}
                      {r.appointed ? <Badge tone="good">Appointed</Badge> : <Badge tone="warn">No current appointment</Badge>}
                      {r.stale && <Badge tone="warn">Appetite review overdue</Badge>}
                      {r.conflicting && <Badge tone="bad">Conflicting rules: check</Badge>}
                      {r.limit.state === "BELOW" && <Badge tone="bad">Limit too low</Badge>}
                    </div>
                    {r.missing.length > 0 && (
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        Missing: {r.missing.map((m) => `${m.label} (${m.reason}; could make it ${label(m.outcome).toLowerCase()})`).join("; ")}.
                        {" "}Otherwise: {label(r.outcome)}.
                      </p>
                    )}
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
                    <ConditionList conditions={r.conditions} />
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
