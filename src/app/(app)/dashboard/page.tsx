import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { dashboard } from "@/server/services/overview";
import { Section, fmtDate, fmtDateTime, label } from "@/components/ui";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireAuth();
  const d = await dashboard(ctx);
  return (
    <>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile href="/approvals" title="Waiting for your review" value={d.pending} />
        <Tile href="/approvals" title="Your submissions waiting" value={d.mySubmissions} />
        <Tile href="/approvals" title="Appetite overdue for review" value={d.overdueAppetiteCount} />
        <Tile href="/contacts?freshness=stale" title="Contacts stale or never confirmed" value={d.staleContacts} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Carriers you own">
          {d.myCarriers.length === 0 ? <p className="text-sm text-zinc-500">You aren&apos;t the relationship owner for any carrier.</p> : (
            <ul className="text-sm">{d.myCarriers.map((c) => <li key={c.id}><Link href={`/carriers/${c.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{c.displayName}</Link> <span className="text-zinc-500">{label(c.type)}</span></li>)}</ul>
          )}
        </Section>
        <Section title="Your appetite profiles overdue for review">
          {d.myOverdueAppetite.length === 0 ? <p className="text-sm text-zinc-500">None.</p> : (
            <ul className="text-sm">{d.myOverdueAppetite.map((p) => <li key={p.id}><Link href={`/appetite/${p.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{p.carrierProduct.writingCompany.displayName} · {p.carrierProduct.product.name} v{p.version}</Link> <span className="text-zinc-500">due {fmtDate(p.nextReviewAt)}</span></li>)}</ul>
          )}
        </Section>
        <Section title={`Appointments ending in the next ${d.warn} days`}>
          {d.expiring.length === 0 ? <p className="text-sm text-zinc-500">None.</p> : (
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
          {d.recentAppetite.length === 0 ? <p className="text-sm text-zinc-500">None.</p> : (
            <ul className="text-sm">
              {d.recentAppetite.map((p) => (
                <li key={p.id}>
                  <Link href={`/appetite/${p.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{p.carrierProduct.writingCompany.displayName} · {p.carrierProduct.product.name} v{p.version}</Link>
                  <span className="text-zinc-500"> · {p.approvedBy?.name} · {fmtDateTime(p.approvedAt!)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

function Tile({ href, title, value }: { href: string; title: string; value: number }) {
  return (
    <Link href={href} className="flex flex-col gap-1 rounded border border-zinc-200 bg-white p-3 hover:border-blue-400 dark:border-zinc-700 dark:bg-zinc-900">
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-sm text-zinc-600 dark:text-zinc-400">{title}</span>
    </Link>
  );
}
