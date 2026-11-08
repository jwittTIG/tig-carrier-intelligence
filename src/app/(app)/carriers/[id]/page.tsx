import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { CARRIER_TYPES, getCarrier, listActivity, listCarrierHistory, listCarrierOptions, listLines } from "@/server/services/carriers";
import { listActiveUsers } from "@/server/services/users";
import { isFollowing } from "@/server/services/notifications";
import { followAction } from "../../notifications/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, Section, fmtDate, fmtDateTime, inputClass, label } from "@/components/ui";
import {
  addActivityAction,
  addChannelAction,
  addIdentifierAction,
  addProductAction,
  addRelationshipAction,
  endRelationshipAction,
  removeIdentifierAction,
  setArchivedAction,
  setChannelArchivedAction,
  setProductArchivedAction,
  updateCarrierAction,
} from "../actions";
import { CarrierFields } from "../carrier-fields";
import { CodesTab } from "./codes-tab";
import { ContactsTab } from "./contacts-tab";
import { AppetiteTab, CommissionsTab, DocumentsTab, UpdatesTab } from "./m4-tabs";

const TABS = [
  { key: "overview", name: "Overview" },
  { key: "channels", name: "Writing companies & channels" },
  { key: "contacts", name: "Contacts" },
  { key: "codes", name: "Codes & portals" },
  { key: "appetite", name: "Appetite" },
  { key: "commissions", name: "Commissions" },
  { key: "documents", name: "Documents" },
  { key: "updates", name: "Updates" },
  { key: "activity", name: "Activity" },
  { key: "history", name: "Change history" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const RELATIONSHIP_TYPES = ["GROUP_MEMBER", "WRITING_COMPANY_OF", "MGA_FOR", "MGU_FOR", "WHOLESALER_FOR", "PROGRAM_ADMIN_FOR", "GENERAL_AGENT_FOR", "OTHER"];
const DISTRIBUTION_TYPES = ["DIRECT", "WHOLESALE", "MGA", "PROGRAM", "AGGREGATOR", "OTHER"];
const ACCESS_STATUSES = ["AVAILABLE", "RESTRICTED", "CLOSED", "UNKNOWN"];
const ACTIVITY_TYPES = ["NOTE", "CALL", "MEETING", "EMAIL", "VISIT", "OTHER"];

function isCurrent(r: { effectiveTo: Date | null }) {
  return !r.effectiveTo || r.effectiveTo >= new Date(new Date().toISOString().slice(0, 10));
}

export async function generateMetadata({ params }: PageProps<"/carriers/[id]">) {
  const ctx = await requireAuth();
  try {
    const c = await getCarrier(ctx, (await params).id);
    return { title: c.displayName };
  } catch {
    return { title: "Carrier" };
  }
}

export default async function CarrierPage({ params, searchParams }: PageProps<"/carriers/[id]">) {
  const ctx = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "overview";
  let carrier;
  try {
    carrier = await getCarrier(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const write = can(ctx, "carrier.write");
  const following = carrier.type !== "AGENCY" && (await isFollowing(ctx, id));

  return (
    <>
      <Link href="/carriers" className="text-sm hover:underline">← Carriers</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{carrier.displayName}</h1>
        <Badge>{label(carrier.type)}</Badge>
        {carrier.archivedAt ? <Badge tone="bad">Archived {fmtDate(carrier.archivedAt)}</Badge> : <Badge tone={carrier.status === "ACTIVE" ? "good" : "neutral"}>{label(carrier.status)}</Badge>}
        {carrier.portalUrl && (
          <a href={carrier.portalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
            Log in to carrier portal <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {carrier.type !== "AGENCY" && (
          <ActionForm action={followAction.bind(null, id, following)} submitLabel={following ? "Unfollow" : "Follow"} variant="secondary" className="ml-auto flex items-center gap-2">
            {following && <span className="text-xs text-zinc-600 dark:text-zinc-400">You get notifications for this carrier.</span>}
          </ActionForm>
        )}
      </div>
      {carrier.legalName !== carrier.displayName && <p className="-mt-3 text-sm text-zinc-600 dark:text-zinc-400">{carrier.legalName}</p>}

      <nav aria-label="Carrier sections" className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-700">
        {TABS.filter((t) => t.key !== "commissions" || can(ctx, "commission.read")).map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? `/carriers/${id}` : `/carriers/${id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-blue-700 font-medium" : "border-transparent hover:border-zinc-300"}`}
          >
            {t.name}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview carrier={carrier} write={write} />}
      {tab === "channels" && <Channels carrier={carrier} write={write} />}
      {tab === "contacts" && <ContactsTab carrierId={id} />}
      {tab === "codes" && <CodesTab carrierId={id} />}
      {tab === "appetite" && <AppetiteTab carrier={carrier} />}
      {tab === "commissions" && <CommissionsTab carrierId={id} />}
      {tab === "documents" && <DocumentsTab carrierId={id} />}
      {tab === "updates" && <UpdatesTab carrierId={id} />}
      {tab === "activity" && <Activity id={id} write={write} />}
      {tab === "history" && <History id={id} />}
    </>
  );
}

type Carrier = Awaited<ReturnType<typeof getCarrier>>;

async function Overview({ carrier, write }: { carrier: Carrier; write: boolean }) {
  const ctx = await requireAuth();
  const [options, owners] = await Promise.all([listCarrierOptions(ctx), listActiveUsers(ctx)]);
  const others = options.filter((o) => o.id !== carrier.id);
  const id = carrier.id;
  const rels = [
    ...carrier.relationshipsOut.map((r) => ({ ...r, other: r.toOrg, direction: "out" as const })),
    ...carrier.relationshipsIn.map((r) => ({ ...r, other: r.fromOrg, direction: "in" as const })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Section title="Details">
        {write ? (
          <ActionForm action={updateCarrierAction.bind(null, id)} submitLabel="Save changes">
            <CarrierFields
              d={carrier}
              types={CARRIER_TYPES}
              parents={others.map((p) => ({ id: p.id, name: p.displayName }))}
              owners={owners}
            />
          </ActionForm>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>Owner</dt><dd>{carrier.owner?.name ?? "Unassigned"}</dd>
            <dt>Parent</dt><dd>{carrier.parent?.displayName ?? "None"}</dd>
            <dt>Carrier portal site</dt><dd>{carrier.portalUrl ? <a href={carrier.portalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-800 hover:underline dark:text-blue-300">{carrier.portalUrl}</a> : "—"}</dd>
            <dt>Website</dt><dd>{carrier.website ?? "—"}</dd>
          </dl>
        )}
        {carrier.children.length > 0 && (
          <p className="text-sm">
            Members:{" "}
            {carrier.children.map((c, i) => (
              <span key={c.id}>{i > 0 && ", "}<Link href={`/carriers/${c.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{c.displayName}</Link></span>
            ))}
          </p>
        )}
      </Section>

      <Section title="Identifiers">
        {carrier.identifiers.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">None recorded.</p> : (
          <ul className="flex flex-col gap-2 text-sm">
            {carrier.identifiers.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3">
                <span><strong>{i.type}</strong> {i.value}{i.jurisdiction && ` (${i.jurisdiction})`}</span>
                {write && (
                  <ActionForm action={removeIdentifierAction.bind(null, id, i.id)} submitLabel="Remove" variant="danger" showOk={false} confirm={`Remove ${i.type} ${i.value}?`}>
                    {null}
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {write && (
          <ActionForm action={addIdentifierAction.bind(null, id)} submitLabel="Add identifier" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Type" htmlFor="idType" hint="e.g. NAIC, FEIN, AM_BEST_ID">
              <input id="idType" name="type" required maxLength={40} className={inputClass} />
            </Field>
            <Field label="Value" htmlFor="idValue"><input id="idValue" name="value" required maxLength={80} className={inputClass} /></Field>
            <Field label="Jurisdiction (optional)" htmlFor="idJur"><input id="idJur" name="jurisdiction" maxLength={40} className={inputClass} /></Field>
          </ActionForm>
        )}
      </Section>

      <Section title="Relationships">
        {rels.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">No relationships recorded.</p> : (
          <ul className="flex flex-col gap-3 text-sm">
            {rels.map((r) => (
              <li key={r.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {r.direction === "out" ? <span>This carrier is <strong>{label(r.relationshipType)}</strong></span> : <span><strong>{label(r.relationshipType)}</strong> this carrier:</span>}
                  <Link href={`/carriers/${r.other.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{r.other.displayName}</Link>
                  <span className="text-zinc-600 dark:text-zinc-400">{fmtDate(r.effectiveFrom)} → {r.effectiveTo ? fmtDate(r.effectiveTo) : "open"}</span>
                  {!isCurrent(r) && <Badge>Ended</Badge>}
                </div>
                {write && !r.effectiveTo && (
                  <ActionForm action={endRelationshipAction.bind(null, id, r.id)} submitLabel="End relationship" variant="secondary" className="flex flex-wrap items-end gap-2">
                    <Field label="End date" htmlFor={`end-${r.id}`}><input id={`end-${r.id}`} name="effectiveTo" type="date" required className={inputClass} /></Field>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {write && (
          <ActionForm action={addRelationshipAction.bind(null, id)} submitLabel="Add relationship" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="This carrier is…" htmlFor="relType">
              <select id="relType" name="relationshipType" required className={inputClass}>
                {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </select>
            </Field>
            <Field label="…of / for" htmlFor="relTo">
              <select id="relTo" name="toOrgId" required className={inputClass}>
                {others.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
              </select>
            </Field>
            <Field label="From (optional)" htmlFor="relFrom"><input id="relFrom" name="effectiveFrom" type="date" className={inputClass} /></Field>
            <Field label="To (optional)" htmlFor="relEnd"><input id="relEnd" name="effectiveTo" type="date" className={inputClass} /></Field>
          </ActionForm>
        )}
      </Section>

      {write && (
        <Section title={carrier.archivedAt ? "Restore" : "Archive"}>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {carrier.archivedAt
              ? "Restoring puts this carrier back in the directory."
              : "Archiving hides this carrier from the directory. Its history, products and relationships are kept."}
          </p>
          <ActionForm
            action={setArchivedAction.bind(null, id, !carrier.archivedAt)}
            submitLabel={carrier.archivedAt ? "Restore carrier" : "Archive carrier"}
            variant={carrier.archivedAt ? "secondary" : "danger"}
            confirm={carrier.archivedAt ? undefined : `Archive ${carrier.displayName}?`}
          >
            {null}
          </ActionForm>
        </Section>
      )}
    </div>
  );
}

async function Channels({ carrier, write }: { carrier: Carrier; write: boolean }) {
  const ctx = await requireAuth();
  const [lines, intermediaries] = await Promise.all([
    listLines(ctx),
    listCarrierOptions(ctx, { types: ["MGA", "MGU", "WHOLESALER", "PROGRAM_ADMIN", "GENERAL_AGENCY", "OTHER"] }),
  ]);
  const id = carrier.id;
  const writes = carrier.type === "INSURER" || carrier.type === "OTHER";

  return (
    <div className="flex flex-col gap-4">
      {carrier.channelsAsIntermediary.length > 0 && (
        <Section title="Acts as a channel for">
          <ul className="flex flex-col gap-1 text-sm">
            {carrier.channelsAsIntermediary.map((ch) => (
              <li key={ch.id}>
                {label(ch.distributionType)} for{" "}
                <Link href={`/carriers/${ch.carrierProduct.writingCompany.id}?tab=channels`} className="text-blue-800 hover:underline dark:text-blue-300">{ch.carrierProduct.writingCompany.displayName}</Link>
                {" "}· {ch.carrierProduct.product.name} · <Badge>{label(ch.accessStatus)}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!writes && carrier.carrierProducts.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {label(carrier.type)} organizations don&apos;t write products. Add them as channels on an insurer&apos;s product instead.
        </p>
      ) : (
        <Section title="Products written">
          {carrier.carrierProducts.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">No products recorded.</p>}
          <ul className="flex flex-col gap-4">
            {carrier.carrierProducts.map((cp) => (
              <li key={cp.id} className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <strong>{cp.product.name}</strong>
                  <span className="text-zinc-600 dark:text-zinc-400">{cp.product.line.name}</span>
                  {cp.programName && <Badge>{cp.programName}</Badge>}
                  {cp.archivedAt && <Badge tone="bad">Archived</Badge>}
                  {write && (
                    <ActionForm action={setProductArchivedAction.bind(null, id, cp.id, !cp.archivedAt)} submitLabel={cp.archivedAt ? "Restore" : "Archive"} variant="secondary" showOk={false} className="ml-auto">
                      {null}
                    </ActionForm>
                  )}
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-zinc-600 dark:text-zinc-400">
                    <tr><th scope="col" className="py-1">Channel</th><th scope="col" className="py-1">Through</th><th scope="col" className="py-1">Access</th><th scope="col" className="py-1"><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {cp.channels.length === 0 && <tr><td colSpan={4} className="py-1 text-zinc-600 dark:text-zinc-400">No channels yet.</td></tr>}
                    {cp.channels.map((ch) => (
                      <tr key={ch.id} className={ch.archivedAt ? "text-zinc-400" : ""}>
                        <td className="py-1">{label(ch.distributionType)}{ch.archivedAt && " (archived)"}</td>
                        <td className="py-1">{ch.intermediary ? <Link href={`/carriers/${ch.intermediary.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{ch.intermediary.displayName}</Link> : "—"}</td>
                        <td className="py-1"><Badge>{label(ch.accessStatus)}</Badge></td>
                        <td className="py-1">
                          {write && (
                            <ActionForm action={setChannelArchivedAction.bind(null, id, ch.id, !ch.archivedAt)} submitLabel={ch.archivedAt ? "Restore" : "Archive"} variant="secondary" showOk={false}>
                              {null}
                            </ActionForm>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {write && !cp.archivedAt && (
                  <ActionForm action={addChannelAction.bind(null, id, cp.id)} submitLabel="Add channel" className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <Field label="Channel" htmlFor={`dt-${cp.id}`}>
                      <select id={`dt-${cp.id}`} name="distributionType" className={inputClass}>
                        {DISTRIBUTION_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                      </select>
                    </Field>
                    <Field label="Through (not for direct)" htmlFor={`im-${cp.id}`}>
                      <select id={`im-${cp.id}`} name="intermediaryOrgId" className={inputClass}>
                        <option value="">None</option>
                        {intermediaries.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
                      </select>
                    </Field>
                    <Field label="Access" htmlFor={`as-${cp.id}`}>
                      <select id={`as-${cp.id}`} name="accessStatus" defaultValue="UNKNOWN" className={inputClass}>
                        {ACCESS_STATUSES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                      </select>
                    </Field>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          {write && writes && (
            <ActionForm action={addProductAction.bind(null, id)} submitLabel="Add lines" className="flex flex-col gap-3">
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Lines this carrier writes</legend>
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  {lines.map((l) => {
                    const has = carrier.carrierProducts.some((cp) => !cp.archivedAt && !cp.programName && cp.product.line.name === l.name && cp.product.code === l.code);
                    return (
                      <label key={l.id} className={`flex items-center gap-2 text-sm ${has ? "text-zinc-600 dark:text-zinc-400" : ""}`}>
                        <input type="checkbox" name="lineIds" value={l.id} defaultChecked={has} disabled={has} className="h-4 w-4 accent-blue-700" />
                        {l.name}{has && <span className="text-xs"> (added)</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Product name (optional)" htmlFor="productName" hint="Only for a specific product, e.g. Contractors GL, with one line ticked. Leave blank to add each line as is.">
                  <input id="productName" name="productName" maxLength={120} className={inputClass} />
                </Field>
                <Field label="Program name (optional)" htmlFor="programName"><input id="programName" name="programName" maxLength={120} className={inputClass} /></Field>
              </div>
            </ActionForm>
          )}
        </Section>
      )}
    </div>
  );
}

async function Activity({ id, write }: { id: string; write: boolean }) {
  const ctx = await requireAuth();
  const items = await listActivity(ctx, id);
  return (
    <Section title="Activity and notes">
      {write && (
        <ActionForm action={addActivityAction.bind(null, id)} submitLabel="Add note">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Type" htmlFor="actType">
              <select id="actType" name="type" className={inputClass}>
                {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </select>
            </Field>
            <Field label="When (optional)" htmlFor="actWhen" hint="Defaults to now">
              <input id="actWhen" name="occurredAt" type="datetime-local" className={inputClass} />
            </Field>
          </div>
          <Field label="Note" htmlFor="actNotes">
            <textarea id="actNotes" name="notes" required maxLength={5000} rows={3} className={inputClass} />
          </Field>
        </ActionForm>
      )}
      {items.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">No activity yet.</p> : (
        <ol className="flex flex-col gap-3">
          {items.map((a) => (
            <li key={a.id} className="border-l-2 border-zinc-300 pl-3 text-sm dark:border-zinc-600">
              <div className="text-xs text-zinc-600 dark:text-zinc-400">{label(a.type)} · {fmtDateTime(a.occurredAt)} · {a.owner.name}</div>
              <p className="whitespace-pre-wrap">{a.notes}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function changedFields(before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const skip = new Set(["updatedAt", "createdAt", "id"]);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !skip.has(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  if (!before) return "";
  return keys.map((k) => `${k}: ${JSON.stringify(b[k] ?? null)} → ${JSON.stringify(a[k] ?? null)}`).join("; ");
}

async function History({ id }: { id: string }) {
  const ctx = await requireAuth();
  if (!can(ctx, "audit.read")) return <p className="text-sm">You don&apos;t have permission to view change history.</p>;
  const events = await listCarrierHistory(ctx, id);
  return (
    <Section title="Change history">
      {events.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">No recorded changes.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-600 dark:text-zinc-400">
              <tr><th scope="col" className="py-1 pr-3">When</th><th scope="col" className="py-1 pr-3">Who</th><th scope="col" className="py-1 pr-3">What</th><th scope="col" className="py-1">Changes</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="whitespace-nowrap py-1 pr-3">{fmtDateTime(e.occurredAt)}</td>
                  <td className="py-1 pr-3">{e.actor?.name ?? "System"}</td>
                  <td className="py-1 pr-3">{e.action}</td>
                  <td className="py-1 font-mono text-xs break-all">{changedFields(e.beforeState, e.afterState)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
