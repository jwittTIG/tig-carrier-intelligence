import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { listAuditEvents } from "@/server/services/audit-log";
import { listActiveUsers } from "@/server/services/users";
import { HistoryTable } from "@/components/history-table";
import { Section, inputClass } from "@/components/ui";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const ctx = await requireAuth();
  if (!can(ctx, "audit.read")) return <p role="alert">You don&apos;t have permission to view the audit log.</p>;
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v)) as Record<string, string>;
  const [r, users] = await Promise.all([listAuditEvents(ctx, params), listActiveUsers(ctx)]);
  const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
  const href = (p: number) => `/admin/audit?${new URLSearchParams({ ...params, page: String(p) })}`;
  return (
    <>
      <h1 className="text-xl font-semibold">Audit log</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Every change is recorded here. Entries can&apos;t be edited or deleted.</p>
      <form method="get" role="search" className="grid grid-cols-1 gap-3 rounded-2xl border border-transparent bg-white shadow-sm p-3 sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-700 dark:bg-zinc-900">
        <label className="flex flex-col gap-1 text-sm">
          Record type
          <select name="entityType" defaultValue={params.entityType ?? ""} className={inputClass}>
            <option value="">Any</option>
            {r.entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Action starts with<input name="action" defaultValue={params.action} placeholder="appetite." className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-sm">
          Who
          <select name="actorId" defaultValue={params.actorId ?? ""} className={inputClass}>
            <option value="">Anyone</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">From<input name="from" type="date" defaultValue={params.from} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-sm">To<input name="to" type="date" defaultValue={params.to} className={inputClass} /></label>
        <div className="flex items-end gap-2">
          <button className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Filter</button>
          <Link href="/admin/audit" className="px-2 py-1.5 text-sm hover:underline">Clear</Link>
        </div>
      </form>
      <Section title={`${r.total} entries`}>
        <HistoryTable events={r.items} />
      </Section>
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
          {r.page > 1 && <Link href={href(r.page - 1)} className="hover:underline">← Newer</Link>}
          <span>Page {r.page} of {pages}</span>
          {r.page < pages && <Link href={href(r.page + 1)} className="hover:underline">Older →</Link>}
        </nav>
      )}
    </>
  );
}
