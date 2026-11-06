import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { listInbox } from "@/server/services/inbox";
import { ActionForm } from "@/components/action-form";
import { Badge, Section, fmtDateTime, inputClass, label } from "@/components/ui";
import { runIntakeAction } from "./actions";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const ctx = await requireAuth();
  if (!can(ctx, "inbox.read")) return <p role="alert">You don&apos;t have permission to view the inbox.</p>;
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v)) as Record<string, string>;
  const r = await listInbox(ctx, params);
  const devMode = r.state.some((s) => s.mailbox.endsWith("@example.invalid"));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Inbox: carrier updates</h1>
        {can(ctx, "inbox.manage") && (
          <ActionForm action={runIntakeAction} submitLabel="Check mailbox now" variant="secondary" className="flex flex-col items-end gap-1">{null}</ActionForm>
        )}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Forward carrier bulletins, guideline updates and appetite changes to the carrier-updates mailbox. Each one appears here to be filed under a carrier,
        cited as a source, or turned into an appetite draft. Nothing changes in the app until someone does that, and appetite still needs approval.
      </p>
      {devMode && <p role="note" className="rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">Development mailbox: reading <code>.eml</code> files from <code>.data/inbox</code>, not Microsoft 365.</p>}
      {r.state.length > 0 && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {r.state.map((s) => <span key={s.mailbox} className="mr-3">{s.mailbox}: last checked {s.lastRunAt ? fmtDateTime(s.lastRunAt) : "never"}{s.lastError && <span className="text-red-700"> · problem: {s.lastError}</span>}</span>)}
        </p>
      )}

      <nav aria-label="Inbox filters" className="flex flex-wrap gap-2 text-sm">
        {[["", `All`], ["NEW", `New (${r.counts.new})`], ["TRIAGED", "Done"], ["DISMISSED", "Dismissed"], ["HELD", `Held: unknown sender (${r.counts.held})`]].map(([v, t]) => (
          <Link key={v} href={v ? `/inbox?status=${v}` : "/inbox"} aria-current={(params.status ?? "") === v ? "page" : undefined} className={`rounded border px-2 py-1 ${(params.status ?? "") === v ? "border-blue-700 font-medium" : "border-zinc-300 dark:border-zinc-600"}`}>{t}</Link>
        ))}
        <form method="get" role="search" className="ml-auto flex gap-2">
          {params.status && <input type="hidden" name="status" value={params.status} />}
          <label className="sr-only" htmlFor="inboxQ">Search the inbox</label>
          <input id="inboxQ" name="q" defaultValue={params.q} placeholder="Subject, sender or text" className={inputClass} />
          <button className="rounded-lg bg-blue-700 px-3 py-1 text-white">Search</button>
        </form>
      </nav>

      <Section title={`${r.items.length} emails`}>
        {r.items.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing here.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-600 dark:text-zinc-400"><tr><th scope="col" className="py-1 pr-3">Subject</th><th scope="col" className="py-1 pr-3">From</th><th scope="col" className="py-1 pr-3">Received</th><th scope="col" className="py-1 pr-3">Carrier</th><th scope="col" className="py-1">Status</th></tr></thead>
            <tbody>
              {r.items.map((m) => (
                <tr key={m.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-1 pr-3"><Link href={`/inbox/${m.id}`} className="font-medium text-blue-800 dark:text-blue-300">{m.subject}</Link>{m._count.attachments > 0 && <span className="text-xs text-zinc-600 dark:text-zinc-400"> · {m._count.attachments} file{m._count.attachments > 1 ? "s" : ""}</span>}</td>
                  <td className="py-1 pr-3">{m.originalFrom ?? m.fromName ?? m.fromAddress}{m.senderUser && <div className="text-xs text-zinc-600 dark:text-zinc-400">forwarded by {m.senderUser.name}</div>}</td>
                  <td className="whitespace-nowrap py-1 pr-3">{fmtDateTime(m.receivedAt)}</td>
                  <td className="py-1 pr-3">{m.organization ? <Link href={`/carriers/${m.organization.id}?tab=updates`}>{m.organization.displayName}</Link> : "—"}</td>
                  <td className="py-1">{m.senderStatus === "HELD" ? <Badge tone="warn">Held</Badge> : <Badge tone={m.status === "NEW" ? "warn" : m.status === "TRIAGED" ? "good" : "neutral"}>{m.status === "TRIAGED" ? "Done" : label(m.status)}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
