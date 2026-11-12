import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { compareMarkets } from "@/server/services/compare";
import { OutcomeBadge } from "@/components/m4";
import { Badge, fmtDate, label } from "@/components/ui";
import { ConditionList, firstValues } from "../risk";

export const metadata = { title: "Compare markets" };

export default async function ComparePage({ searchParams }: PageProps<"/markets/compare">) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const params = firstValues(sp);
  const pick = Array.isArray(sp.pick) ? sp.pick : sp.pick ? [sp.pick] : [];
  const back = `/markets?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1] && e[0] !== "pick")).toString()}`;

  let data: Awaited<ReturnType<typeof compareMarkets>> | null = null;
  let error: string | null = null;
  try {
    data = await compareMarkets(ctx, { ...params, pick });
  } catch (e) {
    if (e instanceof AppError) error = e.message;
    else throw e;
  }

  return (
    <>
      <Link href={back} className="back-link">← Back to Market Finder</Link>
      <h1 className="page-title">Compare markets</h1>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {data && (
        <>
          <p role="note" className="rounded-xl border border-zinc-300 bg-zinc-100 p-2 text-sm dark:border-zinc-600 dark:bg-zinc-800">{data.disclaimer}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Risk: {[data.filters.stateCode, data.filters.industry, data.filters.limit ? `limit $${data.filters.limit.toLocaleString("en-US")}` : null, ...data.attributes.filter((a) => data!.risk[a.key] !== undefined).map((a) => `${a.label} ${data!.risk[a.key]}${a.unit ? ` ${a.unit}` : ""}`)].filter(Boolean).join(" · ") || "no details entered"}
          </p>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
            <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
              <caption className="sr-only">Selected markets side by side</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-40 border-b border-zinc-200 p-2 text-left dark:border-zinc-700"><span className="sr-only">Item</span></th>
                  {data.columns.map((c) => (
                    <th key={c.key} scope="col" className="border-b border-zinc-200 p-2 text-left align-top dark:border-zinc-700">
                      <Link href={`/carriers/${c.carrier.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{c.carrier.displayName}</Link>
                      <div className="font-normal text-zinc-600 dark:text-zinc-400">{c.product} · {c.channel}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="align-top">
                <Row title="Outcome">
                  {data.columns.map((c) => (
                    <td key={c.key} className="p-2">
                      {c.group === "NEEDS_INFO" ? <Badge tone="warn">Needs information</Badge> : <OutcomeBadge outcome={c.outcome} />}
                      {c.missing.length > 0 && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Missing: {c.missing.map((m) => m.label).join(", ")}. Otherwise {label(c.outcome).toLowerCase()}.</p>}
                      {c.conflicting && <p className="mt-1"><Badge tone="bad">Conflicting rules</Badge></p>}
                      {c.note && <p className="mt-1 text-xs">{c.note}</p>}
                    </td>
                  ))}
                </Row>
                <Row title="Why">
                  {data.columns.map((c) => (
                    <td key={c.key} className="p-2 text-xs">
                      {c.matchedRules.length ? <ul>{c.matchedRules.map((m) => <li key={m.id}>{label(m.outcome)}: {m.scope}{m.rationale && ` · “${m.rationale}”`}</li>)}</ul> : "No rule applies"}
                    </td>
                  ))}
                </Row>
                <Row title="Conditions">
                  {data.columns.map((c) => <td key={c.key} className="p-2">{c.conditions.length ? <ConditionList conditions={c.conditions} /> : <span className="text-xs">None stated</span>}</td>)}
                </Row>
                <Row title="Limits">
                  {data.columns.map((c) => <td key={c.key} className="p-2 text-xs">{c.limit.state === "BELOW" && <Badge tone="bad">Limit too low</Badge>} {c.limit.text}</td>)}
                </Row>
                <Row title="Underwriting requirements">
                  {data.columns.map((c) => (
                    <td key={c.key} className="p-2 text-xs">
                      {c.requirements.length ? <ul>{c.requirements.map((r) => <li key={r.id}>{r.requirementType}: {r.description}</li>)}</ul> : "None recorded"}
                    </td>
                  ))}
                </Row>
                <Row title="Agency codes">
                  {data.columns.map((c) => (
                    <td key={c.key} className="p-2 text-xs">
                      {c.codes === null ? "—" : c.codes.length ? <ul>{c.codes.map((x) => <li key={x.id}>{label(x.type)} code {x.value}</li>)}</ul> : "No code recorded"}
                    </td>
                  ))}
                </Row>
                {data.columns[0]?.commission && (
                  <Row title="Commission in effect">
                    {data.columns.map((c) => (
                      <td key={c.key} className="p-2 text-xs">
                        <ul>
                          {c.commission!.map((x) => (
                            <li key={x.type}>{label(x.type)}: {x.agreementId ? <Link href={`/commissions/${x.agreementId}`} className="hover:underline">{x.text}</Link> : x.text}</li>
                          ))}
                        </ul>
                      </td>
                    ))}
                  </Row>
                )}
                <Row title="Appetite record">
                  {data.columns.map((c) => (
                    <td key={c.key} className="p-2 text-xs">
                      {c.profileId ? <Link href={`/appetite/${c.profileId}`} className="hover:underline">Version {c.version}</Link> : "No appetite profile"}
                      {c.profileId && <> · {c.sources} {c.sources === 1 ? "source" : "sources"} · next review {fmtDate(c.nextReviewAt)}</>}
                      {c.stale && <p className="mt-1"><Badge tone="warn">Review overdue</Badge></p>}
                    </td>
                  ))}
                </Row>
                <Row title="Contacts">
                  {data.columns.map((c) => (
                    <td key={c.key} className="p-2 text-xs">
                      {c.contacts.length ? (
                        <ul>{c.contacts.map((p) => <li key={p.id}><Link href={`/contacts/${p.id}`} className="hover:underline">{p.name}</Link> ({label(p.role)}){p.email && ` ${p.email}`}{p.phone && ` ${p.phone}`}</li>)}</ul>
                      ) : "None recorded"}
                    </td>
                  ))}
                </Row>
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800">
      <th scope="row" className="p-2 text-left font-medium">{title}</th>
      {children}
    </tr>
  );
}
