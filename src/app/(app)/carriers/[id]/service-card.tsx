import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { adminToolsOn } from "@/server/auth/view";
import { carrierSnapshot } from "@/server/services/snapshot";
import { mainContacts } from "@/server/services/contacts";
import { listProfilesForCarrier } from "@/server/services/appetite";
import { aiStatus, listGuides } from "@/server/services/guides";
import { ActionForm } from "@/components/action-form";
import { MainContactsCard } from "@/components/main-contacts";
import { NotRecorded, Phone } from "@/components/carrier-snapshot";
import { Section, inputClass } from "@/components/ui";
import { askAction } from "../../ask/actions";

const CODE_TYPE: Record<string, string> = { MASTER: "Master", PRODUCER: "Producer", SUB_CODE: "Sub-code", LOCATION: "Location", OTHER: "Other" };

type Carrier = {
  id: string;
  displayName: string;
  carrierProducts: { id: string; archivedAt: Date | null; product: { name: string; line: { segment: string } } }[];
};

/**
 * The carrier page a service person lands on (Josh, 2026-11-16): the numbers and links for a
 * client call on one screen. Phones, agency code, main contacts, what the carrier writes (with
 * approved appetite), its guides, and a box to ask the guides about this carrier. Managing
 * the carrier (details, channels, commissions, history) lives under "More".
 */
export async function ServiceCard({ carrier }: { carrier: Carrier }) {
  const ctx = await requireAuth();
  const id = carrier.id;
  const admin = await adminToolsOn();
  const canAsk = can(ctx, "guides.ask") && can(ctx, "document.read") && aiStatus().mode !== "off";
  const [snap, main, profiles, guides] = await Promise.all([
    carrierSnapshot(ctx, id),
    can(ctx, "contact.read") ? mainContacts(ctx, id) : Promise.resolve(null),
    can(ctx, "appetite.read") ? listProfilesForCarrier(ctx, id) : Promise.resolve(null),
    can(ctx, "document.read") ? listGuides(ctx, id) : Promise.resolve(null),
  ]);
  const editHref = admin && can(ctx, "carrier.write") ? `/carriers/${id}?edit=1` : null;
  const approved = new Map((profiles ?? []).filter((p) => p.status === "APPROVED" && !p.marketChannelId).map((p) => [p.carrierProductId, p]));
  const products = carrier.carrierProducts.filter((p) => !p.archivedAt);
  const groups = [
    { label: "Personal lines", items: products.filter((p) => p.product.line.segment === "PERSONAL") },
    { label: "Commercial lines", items: products.filter((p) => p.product.line.segment !== "PERSONAL") },
  ].filter((g) => g.items.length);

  return (
    <div className="flex flex-col gap-4">
      {/* Phones and agency code: what a client call needs first. */}
      <section aria-label="Phone numbers and agency code">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="Claims phone"><Phone value={snap.phones.claims} addHref={editHref} /></Tile>
          <Tile label="Billing phone"><Phone value={snap.phones.billing} addHref={editHref} /></Tile>
          <Tile label="Main phone"><Phone value={snap.phones.main} addHref={editHref} /></Tile>
          <Tile label="Agency code">
            {snap.codes === null ? (
              <span className="text-zinc-600 dark:text-zinc-400">No access to codes</span>
            ) : snap.codes.length === 0 ? (
              <NotRecorded href={admin && can(ctx, "appointment.write") ? `/carriers/${id}?tab=codes` : null} />
            ) : (
              <ul className="flex flex-col gap-1">
                {snap.codes.map((c) => (
                  <li key={`${c.type}-${c.value}-${c.producer}`}>
                    <span className="font-mono text-base font-semibold text-zinc-900 dark:text-zinc-100">{c.value}</span>{" "}
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      {CODE_TYPE[c.type] ?? c.type}
                      {c.producer && ` · ${c.producer}`}
                      {snap.codes!.length > 1 && ` · ${c.lines.join(", ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Tile>
        </dl>
      </section>

      {main && <MainContactsCard data={main} addHref={admin && can(ctx, "contact.write") ? `/carriers/${id}?tab=contacts#add-contact` : undefined} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="What they write" description={profiles ? "Lines this carrier writes. Approved appetite opens the rules." : undefined}>
          {groups.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">No lines recorded.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((g) => (
                <div key={g.label} className="flex flex-col gap-1.5">
                  <h3 className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{g.label}</h3>
                  <ul className="flex flex-wrap gap-2">
                    {g.items.map((p) => {
                      const a = approved.get(p.id);
                      return (
                        <li key={p.id}>
                          {a ? (
                            <Link href={`/appetite/${a.id}`} className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[13px] font-medium text-emerald-900 hover:underline dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                              {p.product.name}<span className="text-xs font-normal">· appetite</span>
                            </Link>
                          ) : (
                            <span className="inline-flex min-h-6 items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[13px] text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">{p.product.name}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Section>

        {(canAsk || guides) && (
          <Section title={`Ask about ${carrier.displayName}`} description="A plain-English question, answered from this carrier's guides with page citations.">
            {canAsk ? (
              <ActionForm action={askAction} submitLabel="Ask" pendingLabel="Reading the guides… (this can take a minute)" showOk={false} variant="accent" className="flex flex-col gap-3">
                <label htmlFor="cardQuestion" className="sr-only">Question about {carrier.displayName}</label>
                <textarea id="cardQuestion" name="question" required minLength={3} maxLength={1000} rows={3} placeholder="Will they write a home with a wood shake roof?" className={`${inputClass} resize-none`} />
                <input type="hidden" name="organizationId" value={id} />
              </ActionForm>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Asking isn&apos;t available for you yet.</p>
            )}
            {guides && (
              guides.length === 0 ? (
                <p className="text-xs text-zinc-600 dark:text-zinc-400">No guides on file for this carrier yet, so there&apos;s nothing to answer from.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  <h3 className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Guides on file</h3>
                  <ul className="flex flex-col gap-0.5 text-sm">
                    {guides.map((g) => (
                      <li key={g.documentId}><Link href={`/documents/${g.documentId}`} className="inline-flex min-h-6 items-center text-blue-800 hover:underline dark:text-blue-300">{g.title}</Link></li>
                    ))}
                  </ul>
                </div>
              )
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="text-base">{children}</dd>
    </div>
  );
}
