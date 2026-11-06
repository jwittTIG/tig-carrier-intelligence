import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { listAgencyCodes } from "@/server/services/appointments";
import { listCarrierOptions } from "@/server/services/carriers";
import { listActiveUsers } from "@/server/services/users";
import { EffectiveBadge } from "@/components/freshness";
import { fmtDate, inputClass, label } from "@/components/ui";

export const metadata = { title: "Agency codes" };

export default async function CodesPage({ searchParams }: PageProps<"/codes">) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v)) as Record<string, string>;
  const [codes, carriers, users] = await Promise.all([listAgencyCodes(ctx, params), listCarrierOptions(ctx), listActiveUsers(ctx)]);
  const csvHref = `/api/v1/agency-codes?${new URLSearchParams({ ...params, format: "csv" })}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Agency and producer codes</h1>
        <a href={csvHref} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900">Download CSV</a>
      </div>
      <form method="get" role="search" className="grid grid-cols-1 gap-3 rounded-2xl border border-transparent bg-white shadow-sm p-3 sm:grid-cols-5 dark:border-zinc-700 dark:bg-zinc-900">
        <label className="flex flex-col gap-1 text-sm">Code<input name="q" defaultValue={params.q} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-sm">
          Carrier
          <select name="organizationId" defaultValue={params.organizationId ?? ""} className={inputClass}>
            <option value="">Any</option>
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Producer
          <select name="assignedUserId" defaultValue={params.assignedUserId ?? ""} className={inputClass}>
            <option value="">Anyone</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select name="state" defaultValue={params.state ?? ""} className={inputClass}>
            <option value="">Any</option>
            <option value="current">Current</option>
            <option value="expiring">Expiring soon</option>
            <option value="expired">Expired</option>
            <option value="inactive">Inactive or not yet effective</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Filter</button>
          <Link href="/codes" className="px-2 py-1.5 text-sm hover:underline">Clear</Link>
        </div>
      </form>

      <p className="text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">{codes.length} {codes.length === 1 ? "code" : "codes"}. A code is never shown as current when its appointment has ended.</p>

      <div className="overflow-x-auto rounded-2xl border border-transparent bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-600 dark:text-zinc-400 dark:border-zinc-700">
            <tr>
              <th scope="col" className="px-3 py-2">Carrier</th>
              <th scope="col" className="px-3 py-2">Channel</th>
              <th scope="col" className="px-3 py-2">Code</th>
              <th scope="col" className="px-3 py-2">Type</th>
              <th scope="col" className="px-3 py-2">Producer</th>
              <th scope="col" className="px-3 py-2">Dates</th>
              <th scope="col" className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-600 dark:text-zinc-400">No codes match these filters.</td></tr>}
            {codes.map((c) => {
              const ch = c.appointment.marketChannel;
              return (
                <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <Link href={`/carriers/${ch.carrierProduct.writingCompany.id}?tab=appointments`} className="text-blue-800 hover:underline dark:text-blue-300">{ch.carrierProduct.writingCompany.displayName}</Link>
                  </td>
                  <td className="px-3 py-2">{ch.carrierProduct.product.name}{ch.intermediary ? ` via ${ch.intermediary.displayName}` : " (direct)"}</td>
                  <td className="px-3 py-2 font-mono">{c.codeValue}</td>
                  <td className="px-3 py-2">{label(c.codeType)}</td>
                  <td className="px-3 py-2">{c.assignedUser?.name ?? "—"}</td>
                  <td className="px-3 py-2">{fmtDate(c.effectiveFrom)} → {c.effectiveTo ? fmtDate(c.effectiveTo) : "open"}</td>
                  <td className="px-3 py-2"><EffectiveBadge state={c.state} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
