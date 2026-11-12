import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { can } from "@/server/auth/context";
import { listCarrierOptions, listLines, listPortalLinks } from "@/server/services/carriers";
import { listTerritories } from "@/server/services/contacts";
import { aiStatus, listAskableCarriers } from "@/server/services/guides";
import { dashboard } from "@/server/services/overview";
import { RightMenus } from "@/components/right-tabs";
import { CarrierSnapshot } from "@/components/carrier-snapshot";
import { ActionForm } from "@/components/action-form";
import { askAction } from "../ask/actions";
import { Icon } from "@/components/icons";
import { PageHeader, Section, buttonBase, buttonClass, fmtDate, fmtDateTime, inputClass, label } from "@/components/ui";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireAuth();
  const canCarriers = can(ctx, "carrier.read");
  const canAsk = can(ctx, "guides.ask") && can(ctx, "document.read");
  const canFind = can(ctx, "appetite.read") && canCarriers;
  const [d, portals, carriers, askable, lines, territories] = await Promise.all([
    dashboard(ctx),
    canCarriers ? listPortalLinks(ctx) : Promise.resolve(null),
    canCarriers ? listCarrierOptions(ctx) : Promise.resolve(null),
    canAsk ? listAskableCarriers(ctx) : Promise.resolve([]),
    canFind ? listLines(ctx) : Promise.resolve([]),
    canFind && can(ctx, "contact.read") ? listTerritories(ctx) : Promise.resolve([]),
  ]);
  const aiOn = aiStatus().mode !== "off";
  const carrierList = (carriers ?? []).map((c) => ({ id: c.id, name: c.displayName }));
  const firstName = ctx.name.split(/\s+/)[0];

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <PageHeader title="Dashboard" description={`Welcome back, ${firstName}. Your carriers, markets and follow-ups at a glance.`} />

        {/* Metric strip: one bordered bar, quiet until something needs attention. */}
        <ul aria-label="Work waiting" className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 shadow-xs lg:grid-cols-5 dark:border-zinc-800 dark:bg-zinc-800">
          <Metric href="/approvals" title="Waiting for your review" value={d.pending} icon="approvals" />
          <Metric href="/approvals" title="Your submissions waiting" value={d.mySubmissions} icon="documents" />
          <Metric href="/approvals" title="Appetite overdue for review" value={d.overdueAppetiteCount} icon="markets" />
          <Metric href="/contacts?freshness=stale" title="Contacts stale or never confirmed" value={d.staleContacts} icon="contacts" />
          <Metric href="/inbox?status=NEW" title="Inbox emails to handle" value={d.inboxWaiting} icon="inbox" />
        </ul>

        {(canAsk || canFind) && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {canAsk && (
              <Section title="Ask the guides" description="Plain-English questions, answered from the carrier's guides with page citations.">
                {aiOn ? (
                  <ActionForm action={askAction} submitLabel="Ask" pendingLabel="Reading the guides… (this can take a minute)" showOk={false} variant="accent" className="flex flex-col gap-3">
                    <label htmlFor="dqQuestion" className="sr-only">Question</label>
                    <textarea id="dqQuestion" name="question" required minLength={3} maxLength={1000} rows={3} placeholder="Will Travelers write a home with a wood shake roof?" className={`${inputClass} resize-none`} />
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="dqCarrier" className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">Carrier</label>
                      <select id="dqCarrier" name="organizationId" defaultValue="" className={inputClass}>
                        <option value="">Find it in the question</option>
                        {askable.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                      </select>
                    </div>
                  </ActionForm>
                ) : (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">AI isn&apos;t set up yet. See <Link href="/ask" className="text-blue-700 dark:text-blue-300">Ask the guides</Link>.</p>
                )}
                <Link href="/ask" className="w-fit text-xs text-zinc-600 dark:text-zinc-400">Recent questions</Link>
              </Section>
            )}
            {canFind && (
              <Section title="Find a market" description="Carriers whose approved appetite fits the risk.">
                <form method="get" action="/markets" role="search" aria-label="Find a market" className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="fmLine" className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">Line</label>
                    <select id="fmLine" name="lineId" required defaultValue="" className={inputClass}>
                      <option value="" disabled>Choose a line…</option>
                      {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="fmState" className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">State</label>
                      <select id="fmState" name="stateCode" defaultValue="" className={inputClass}>
                        <option value="">Any</option>
                        {territories.filter((t) => t.stateCode).map((t) => <option key={t.id} value={t.stateCode!}>{t.name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="fmIndustry" className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">Industry (optional)</label>
                      <input id="fmIndustry" name="industry" placeholder="roofing or 238160" className={inputClass} />
                    </div>
                  </div>
                  <div>
                    <button type="submit" className={`${buttonBase} ${buttonClass.primary}`}>Find markets</button>
                  </div>
                </form>
                <Link href="/markets" className="w-fit text-xs text-zinc-600 dark:text-zinc-400">More options (products, limits, risk details)</Link>
              </Section>
            )}
          </div>
        )}

        {carriers && (
          <Section title="Carrier SnapShot" description="Phone numbers, marketing rep and agency code for one carrier.">
            <CarrierSnapshot carriers={carrierList} />
          </Section>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Section title="Carriers you own">
            {d.myCarriers.length === 0 ? <Empty>You aren&apos;t the relationship owner for any carrier.</Empty> : (
              <ul className="-my-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                {d.myCarriers.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/carriers/${c.id}`} className="font-medium text-zinc-900 dark:text-zinc-100">{c.displayName}</Link>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">{label(c.type)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Your appetite overdue for review">
            {d.myOverdueAppetite.length === 0 ? <Empty>Nothing overdue.</Empty> : (
              <ul className="-my-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                {d.myOverdueAppetite.map((p) => (
                  <li key={p.id} className="flex flex-col py-2">
                    <Link href={`/appetite/${p.id}`} className="font-medium text-zinc-900 dark:text-zinc-100">{p.carrierProduct.writingCompany.displayName} · {p.carrierProduct.product.name} v{p.version}</Link>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">Due {fmtDate(p.nextReviewAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Approved in the last 30 days">
            {d.recentAppetite.length === 0 ? <Empty>No appetite approved recently.</Empty> : (
              <ul className="-my-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                {d.recentAppetite.map((p) => (
                  <li key={p.id} className="flex flex-col py-2">
                    <Link href={`/appetite/${p.id}`} className="font-medium text-zinc-900 dark:text-zinc-100">{p.carrierProduct.writingCompany.displayName} · {p.carrierProduct.product.name} v{p.version}</Link>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">{p.approvedBy?.name} · {fmtDateTime(p.approvedAt!)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {(portals || carriers) && (
        <aside aria-label="Quick links" className="w-full shrink-0 xl:sticky xl:top-20 xl:w-80">
          <RightMenus portals={portals} carriers={carriers && can(ctx, "contact.read") ? carrierList : null} />
        </aside>
      )}
    </div>
  );
}

function Metric({ href, title, value, icon }: { href: string; title: string; value: number; icon: string }) {
  return (
    <li className="bg-white last:col-span-2 lg:last:col-span-1 dark:bg-zinc-900">
      <Link href={href} className="group flex h-full flex-col gap-2 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <span className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          <span className="line-clamp-2">{title}</span>
          <Icon name={icon} className={`h-4 w-4 shrink-0 ${value > 0 ? "text-orange-500" : "text-zinc-400"}`} />
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-blue-700 tabular-nums dark:text-zinc-100">{value}</span>
          {value > 0 && <span className="text-xs font-medium text-orange-700 dark:text-orange-300">Needs attention</span>}
        </span>
      </Link>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-600 dark:text-zinc-400">{children}</p>;
}
