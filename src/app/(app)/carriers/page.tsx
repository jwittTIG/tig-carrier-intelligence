import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { CARRIER_TYPES, listCarrierOptions, listCarriers, listLines } from "@/server/services/carriers";
import { listActiveUsers } from "@/server/services/users";
import { Badge, ButtonLink, inputClass, label } from "@/components/ui";

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
        <h1 className="text-xl font-semibold">Carriers</h1>
        {can(ctx, "carrier.write") && <ButtonLink href="/carriers/new">New carrier</ButtonLink>}
      </div>

      <form method="get" className="grid grid-cols-1 gap-3 rounded-2xl border border-transparent bg-white shadow-sm p-3 sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-700 dark:bg-zinc-900" role="search">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Name or identifier
          <input name="q" defaultValue={params.q} className={inputClass} placeholder="e.g. Summit, or a NAIC number" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select name="type" defaultValue={params.type ?? ""} className={inputClass}>
            <option value="">Any</option>
            {CARRIER_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Line
          <select name="lineId" defaultValue={params.lineId ?? ""} className={inputClass}>
            <option value="">Any</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Group
          <select name="parentId" defaultValue={params.parentId ?? ""} className={inputClass}>
            <option value="">Any</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Owner
          <select name="ownerUserId" defaultValue={params.ownerUserId ?? ""} className={inputClass}>
            <option value="">Anyone</option>
            {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
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
          <button type="submit" className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Search</button>
          <Link href="/carriers" className="px-2 py-1.5 text-sm hover:underline">Clear</Link>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 sm:col-span-3 lg:col-span-6">
          State and verification-freshness filters arrive with appointments and appetite (Milestones 3–4).
        </p>
      </form>

      <p className="text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} {result.total === 1 ? "carrier" : "carriers"}
      </p>

      <div className="overflow-x-auto rounded-2xl border border-transparent bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-600 dark:text-zinc-400 dark:border-zinc-700">
            <tr>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">Type</th>
              <th scope="col" className="px-3 py-2">Group</th>
              <th scope="col" className="px-3 py-2">Lines</th>
              <th scope="col" className="px-3 py-2">Owner</th>
              <th scope="col" className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-600 dark:text-zinc-400">No carriers match these filters.</td></tr>
            )}
            {result.items.map((c) => (
              <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">
                  <Link href={`/carriers/${c.id}`} className="font-medium text-blue-800 hover:underline dark:text-blue-300">{c.displayName}</Link>
                  {c.legalName !== c.displayName && <div className="text-xs text-zinc-600 dark:text-zinc-400">{c.legalName}</div>}
                </td>
                <td className="px-3 py-2">{label(c.type)}</td>
                <td className="px-3 py-2">{c.parent?.displayName ?? "—"}</td>
                <td className="px-3 py-2">{c.lines.join(", ") || "—"}</td>
                <td className="px-3 py-2">{c.owner?.name ?? "—"}</td>
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
          {result.page > 1 && <Link href={pageHref(result.page - 1)} className="hover:underline">← Previous</Link>}
          <span>Page {result.page} of {pages}</span>
          {result.page < pages && <Link href={pageHref(result.page + 1)} className="hover:underline">Next →</Link>}
        </nav>
      )}
    </>
  );
}
