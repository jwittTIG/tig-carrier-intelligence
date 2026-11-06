import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { listCarrierOptions, listLines } from "@/server/services/carriers";
import { listContacts, listTerritories } from "@/server/services/contacts";
import { FreshnessBadge } from "@/components/freshness";
import { ButtonLink, inputClass, label } from "@/components/ui";

export const metadata = { title: "Contacts" };

const ROLES = ["UNDERWRITER", "MARKETING_REP", "REGIONAL_MANAGER", "PRODUCT_MANAGER", "SERVICE", "CLAIMS", "OTHER"];

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const [result, carriers, lines, territories] = await Promise.all([
    listContacts(ctx, params),
    listCarrierOptions(ctx),
    listLines(ctx),
    listTerritories(ctx),
  ]);
  const states = territories.filter((t) => t.stateCode);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const pageHref = (p: number) => `/contacts?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>), page: String(p) })}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Contacts</h1>
        {can(ctx, "contact.write") && <ButtonLink href="/contacts/new">New contact</ButtonLink>}
      </div>

      <form method="get" role="search" className="grid grid-cols-1 gap-3 rounded-2xl border border-transparent bg-white shadow-sm p-3 sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-medium sm:col-span-3 lg:col-span-6">Who&apos;s my rep for…</p>
        <label className="flex flex-col gap-1 text-sm">
          Carrier
          <select name="organizationId" defaultValue={params.organizationId ?? ""} className={inputClass}>
            <option value="">Any</option>
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          State
          <select name="stateCode" defaultValue={params.stateCode ?? ""} className={inputClass}>
            <option value="">Any</option>
            {states.map((t) => <option key={t.id} value={t.stateCode!}>{t.name}</option>)}
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
          Role
          <select name="role" defaultValue={params.role ?? ""} className={inputClass}>
            <option value="">Any</option>
            {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Name or email
          <input name="q" defaultValue={params.q} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Confirmation
          <select name="freshness" defaultValue={params.freshness ?? ""} className={inputClass}>
            <option value="">Any</option>
            <option value="stale">Stale or never confirmed</option>
            <option value="fresh">Confirmed recently</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="includeInactive" defaultChecked={params.includeInactive === "on"} />
          Include inactive
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Search</button>
          <Link href="/contacts" className="px-2 py-1.5 text-sm hover:underline">Clear</Link>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 sm:col-span-3 lg:col-span-6">
          A state search matches people assigned to that state or to the whole US. People with no territory recorded don&apos;t match a state search.
          Contacts are due for review {result.cadenceDays} days after they were last confirmed.
        </p>
      </form>

      <p className="text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">{result.total} {result.total === 1 ? "contact" : "contacts"}</p>

      <div className="overflow-x-auto rounded-2xl border border-transparent bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-600 dark:text-zinc-400 dark:border-zinc-700">
            <tr>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">Works with</th>
              <th scope="col" className="px-3 py-2">Contact</th>
              <th scope="col" className="px-3 py-2">Confirmed</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-600 dark:text-zinc-400">No contacts match these filters.</td></tr>}
            {result.items.map((c) => (
              <tr key={c.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">
                  <Link href={`/contacts/${c.id}`} className="font-medium text-blue-800 hover:underline dark:text-blue-300">{c.firstName} {c.lastName}</Link>
                  {c.status !== "ACTIVE" && <span className="text-xs text-zinc-600 dark:text-zinc-400"> (inactive)</span>}
                </td>
                <td className="px-3 py-2">
                  <ul className="flex flex-col gap-0.5">
                    {c.assignments.map((a) => (
                      <li key={a.id}>
                        {label(a.role)} · {a.organization.displayName}
                        {a.territory && ` · ${a.territory.name}`}
                        {a.specialties.length > 0 && <span className="text-zinc-600 dark:text-zinc-400"> · {a.specialties.map((s) => s.product.name).join(", ")}</span>}
                      </li>
                    ))}
                    {c.assignments.length === 0 && <li className="text-zinc-600 dark:text-zinc-400">No current assignment</li>}
                  </ul>
                </td>
                <td className="px-3 py-2">
                  {c.email && <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a>}
                  {c.officePhone && <div>{c.officePhone}</div>}
                </td>
                <td className="px-3 py-2"><FreshnessBadge f={c.freshness} /></td>
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
