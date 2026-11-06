import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { dashboard } from "@/server/services/overview";
import { Icon } from "@/components/icons";
import { Section, fmtDate, fmtDateTime, label } from "@/components/ui";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireAuth();
  const d = await dashboard(ctx);
  return (
    <>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile href="/approvals" title="Waiting for your review" value={d.pending} icon="approvals" />
        <Tile href="/approvals" title="Your submissions waiting" value={d.mySubmissions} icon="documents" />
        <Tile href="/approvals" title="Appetite overdue for review" value={d.overdueAppetiteCount} icon="markets" />
        <Tile href="/contacts?freshness=stale" title="Contacts stale or never confirmed" value={d.staleContacts} icon="contacts" />
        <Tile href="/inbox?status=NEW" title="Inbox emails to handle" value={d.inboxWaiting} icon="inbox" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Carriers you own">
          {d.myCarriers.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">You aren&apos;t the relationship owner for any carrier.</p> : (
            <ul className="text-sm">{d.myCarriers.map((c) => <li key={c.id}><Link href={`/carriers/${c.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{c.displayName}</Link> <span className="text-zinc-600 dark:text-zinc-400">{label(c.type)}</span></li>)}</ul>
          )}
        </Section>
        <Section title="Your appetite profiles overdue for review">
          {d.myOverdueAppetite.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">None.</p> : (
            <ul className="text-sm">{d.myOverdueAppetite.map((p) => <li key={p.id}><Link href={`/appetite/${p.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{p.carrierProduct.writingCompany.displayName} · {p.carrierProduct.product.name} v{p.version}</Link> <span className="text-zinc-600 dark:text-zinc-400">due {fmtDate(p.nextReviewAt)}</span></li>)}</ul>
          )}
        </Section>
        <Section title={`Appointments ending in the next ${d.warn} days`}>
          {d.expiring.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">None.</p> : (
            <ul className="text-sm">
              {d.expiring.map((a) => (
                <li key={a.id}>
                  <Link href={`/carriers/${a.marketChannel.carrierProduct.writingCompany.id}?tab=appointments`} className="text-blue-800 hover:underline dark:text-blue-300">{a.marketChannel.carrierProduct.writingCompany.displayName}</Link>
                  {" "}· {a.marketChannel.carrierProduct.product.name}{a.marketChannel.intermediary ? ` via ${a.marketChannel.intermediary.displayName}` : ""} · ends {fmtDate(a.effectiveTo)}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Appetite approved in the last 30 days">
          {d.recentAppetite.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">None.</p> : (
            <ul className="text-sm">
              {d.recentAppetite.map((p) => (
                <li key={p.id}>
                  <Link href={`/appetite/${p.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{p.carrierProduct.writingCompany.displayName} · {p.carrierProduct.product.name} v{p.version}</Link>
                  <span className="text-zinc-600 dark:text-zinc-400"> · {p.approvedBy?.name} · {fmtDateTime(p.approvedAt!)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

function Tile({ href, title, value, icon }: { href: string; title: string; value: number; icon: string }) {
  return (
    <Link href={href} className="flex items-center gap-4 rounded-2xl border border-transparent bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-4 ${value > 0 ? "border-blue-200 bg-blue-600 text-white dark:border-blue-800" : "border-zinc-100 bg-zinc-100 text-zinc-600 dark:text-zinc-400 dark:border-zinc-800 dark:bg-zinc-800"}`}>
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="flex flex-col">
        <span className="text-2xl font-semibold text-blue-800 dark:text-blue-200">{value}</span>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{title}</span>
      </span>
    </Link>
  );
}
