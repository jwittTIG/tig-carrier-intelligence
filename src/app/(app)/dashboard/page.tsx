import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { can } from "@/server/auth/context";
import { listCarrierOptions, listLines, listPortalLinks } from "@/server/services/carriers";
import { listTerritories } from "@/server/services/contacts";
import { aiStatus, listAskableCarriers } from "@/server/services/guides";
import { dashboard } from "@/server/services/overview";
import { RightMenus } from "@/components/right-tabs";
import { ActionForm } from "@/components/action-form";
import { askAction } from "../ask/actions";
import { Icon } from "@/components/icons";
import { Section, fmtDate, fmtDateTime, inputClass, label } from "@/components/ui";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireAuth();
  const canCarriers = can(ctx, "carrier.read");
  const canAsk = can(ctx, "guides.ask") && can(ctx, "document.read");
  const canFind = can(ctx, "appetite.read") && canCarriers;
  const [d, portals, carriers, askable, lines, territories] = await Promise.all([
    dashboard(ctx),
    canCarriers ? listPortalLinks(ctx) : Promise.resolve(null),
    canCarriers && can(ctx, "contact.read") ? listCarrierOptions(ctx) : Promise.resolve(null),
    canAsk ? listAskableCarriers(ctx) : Promise.resolve([]),
    canFind ? listLines(ctx) : Promise.resolve([]),
    canFind && can(ctx, "contact.read") ? listTerritories(ctx) : Promise.resolve([]),
  ]);
  const aiOn = aiStatus().mode !== "off";
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      {(canAsk || canFind) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {canAsk && (
            <Section title="Ask the guides">
              {aiOn ? (
                <ActionForm action={askAction} submitLabel="Ask" pendingLabel="Reading the guides… (this can take a minute)" showOk={false} className="flex flex-col gap-2">
                  <label htmlFor="dqQuestion" className="sr-only">Question</label>
                  <textarea id="dqQuestion" name="question" required minLength={3} maxLength={1000} rows={3} placeholder="Will Travelers write a home with a wood shake roof?" className={inputClass} />
                  <label htmlFor="dqCarrier" className="text-sm">Carrier</label>
                  <select id="dqCarrier" name="organizationId" defaultValue="" className={inputClass}>
                    <option value="">Find it in the question</option>
                    {askable.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                  </select>
                </ActionForm>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">AI isn&apos;t set up yet. See <Link href="/ask" className="text-blue-800 hover:underline dark:text-blue-300">Ask the guides</Link>.</p>
              )}
              <Link href="/ask" className="text-xs text-blue-800 hover:underline dark:text-blue-300">Recent questions</Link>
            </Section>
          )}
          {canFind && (
            <Section title="Find a market">
              <form method="get" action="/markets" role="search" aria-label="Find a market" className="flex flex-col gap-2">
                <label htmlFor="fmLine" className="text-sm">Line</label>
                <select id="fmLine" name="lineId" required defaultValue="" className={inputClass}>
                  <option value="" disabled>Choose a line…</option>
                  {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="fmState" className="text-sm">State</label>
                    <select id="fmState" name="stateCode" defaultValue="" className={inputClass}>
                      <option value="">Any</option>
                      {territories.filter((t) => t.stateCode).map((t) => <option key={t.id} value={t.stateCode!}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="fmIndustry" className="text-sm">Industry (optional)</label>
                    <input id="fmIndustry" name="industry" placeholder="roofing or 238160" className={inputClass} />
                  </div>
                </div>
                <div>
                  <button type="submit" className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Find markets</button>
                </div>
              </form>
              <Link href="/markets" className="text-xs text-blue-800 hover:underline dark:text-blue-300">More options (products, limits, risk details)</Link>
            </Section>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-5">
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
      </div>

      {(portals || carriers) && (
        <aside aria-label="Quick links" className="w-full shrink-0 xl:w-80">
          <RightMenus portals={portals} carriers={carriers && carriers.map((c) => ({ id: c.id, name: c.displayName }))} />
        </aside>
      )}
    </div>
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
