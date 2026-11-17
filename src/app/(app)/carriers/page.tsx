import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { CARRIER_TYPES, listCarrierOptions, listCarriers, listLines } from "@/server/services/carriers";
import { listActiveUsers } from "@/server/services/users";
import { Badge, ButtonLink, inputClass, label } from "@/components/ui";
import { LineOptions } from "@/components/line-picker";
import { showControl } from "@/server/auth/view";

export const metadata = { title: "Carriers" };

export default async function CarriersPage({ searchParams }: PageProps<"/carriers">) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const [result, lines, owners, groups] = await Promise.all([
    listCarriers(ctx, params),
    listLines(ctx),
    listActiveUsers(ctx),
    listCarrierOptions(ctx, { types: ["GROUP"] }),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const pageHref = (p: number) => `/carriers?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>, page: String(p) })}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Carriers</h1>
        {(await showControl(ctx, "carrier.write")) && <ButtonLink href="/carriers/new">New carrier</ButtonLink>}
      </div>

      <form method="get" className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white shadow-xs p-3 sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-700 dark:bg-zinc-900" role="search">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-zinc-700 sm:col-span-2 dark:text-zinc-200">
          Name or identifier
          <input name="q" defaultValue={params.q} className={inputClass} placeholder="e.g. Summit, or a NAIC number" />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
          Type
          <select name="type" defaultValue={params.type ?? ""} className={inputClass}>
            <option value="">Any</option>
            {CARRIER_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
          Line
          <select name="lineId" defaultValue={params.lineId ?? ""} className={inputClass}>
            <option value="">Any</option>
            <LineOptions lines={lines} />
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
          Group
          <select name="parentId" defaultValue={params.parentId ?? ""} className={inputClass}>
            <option value="">Any</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
          Owner
          <select name="ownerUserId" defaultValue={params.ownerUserId ?? ""} className={inputClass}>
            <option value="">Anyone</option>
            {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
          Status
          <select name="status" defaultValue={params.status ?? ""} className={inputClass}>
            <option value="">Any</option>
            {["ACTIVE", "PROSPECT", "INACTIVE"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="includeArchived" defaultChecked={params.includeArchived === "on" || params.includeArchived === "true"} />
          Include archived
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium bg-blue-700 text-white shadow-xs hover:bg-blue-800">Search</button>
          <Link href="/carriers" className="inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">Clear</Link>
        </div>
      </form>

      <p className="text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} {result.total === 1 ? "carrier" : "carriers"}
      </p>

      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-600 dark:text-zinc-400 dark:border-zinc-700">
            <tr>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">Type</th>
              <th scope="col" className="px-3 py-2">Group</th>
              <th scope="col" className="px-3 py-2">Lines</th>
              <th scope="col" className="px-3 py-2">Owner</th>
              <th scope="col" className="px-3 py-2">Portal</th>
              <th scope="col" className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-600 dark:text-zinc-400">No carriers match these filters.</td></tr>
            )}
            {result.items.map((c) => (
              <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="min-w-48 px-3 py-2">
                  <Link href={`/carriers/${c.id}`} className="font-medium text-zinc-900 hover:text-blue-700 dark:text-zinc-100 dark:hover:text-blue-300">{c.displayName}</Link>
                  {c.legalName !== c.displayName && <div className="text-xs text-zinc-600 dark:text-zinc-400">{c.legalName}</div>}
                </td>
                <td className="px-3 py-2">{label(c.type)}</td>
                <td className="px-3 py-2">{c.parent?.displayName ?? "—"}</td>
                <td className="px-3 py-2">
                  {c.lines.length === 0 ? "—" : (
                    <span className="flex flex-wrap gap-1">
                      {c.lines.slice(0, 3).map((l) => <span key={l} className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{l}</span>)}
                      {c.lines.length > 3 && <span className="px-1 py-0.5 text-xs text-zinc-600 dark:text-zinc-400" title={c.lines.slice(3).join(", ")}>+{c.lines.length - 3} more</span>}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{c.owner?.name ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {c.portalUrl ? <a href={c.portalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-800 hover:underline dark:text-blue-300">Log in<span className="sr-only"> to the {c.displayName} portal (opens in a new tab)</span> ↗</a> : "—"}
                </td>
                <td className="px-3 py-2">
                  {c.archivedAt ? <Badge tone="bad">Archived</Badge> : <Badge tone={c.status === "ACTIVE" ? "good" : "neutral"}>{label(c.status)}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
          {result.page > 1 && <Link href={pageHref(result.page - 1)} className="inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">← Previous</Link>}
          <span>Page {result.page} of {pages}</span>
          {result.page < pages && <Link href={pageHref(result.page + 1)} className="inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">Next →</Link>}
        </nav>
      )}
    </>
  );
}
