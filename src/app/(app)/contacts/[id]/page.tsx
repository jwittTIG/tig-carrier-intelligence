import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { channelLabel, listAllChannels } from "@/server/services/appointments";
import { listCarrierOptions, listProducts } from "@/server/services/carriers";
import { getContact, listContactActivity, listContactHistory, listContactOptions, listTerritories } from "@/server/services/contacts";
import { ActionForm } from "@/components/action-form";
import { FreshnessBadge } from "@/components/freshness";
import { HistoryTable } from "@/components/history-table";
import { Badge, Field, Section, fmtDate, fmtDateTime, inputClass, label } from "@/components/ui";
import {
  addAssignmentAction,
  addContactActivityAction,
  addSpecialtyAction,
  endAssignmentAction,
  removeSpecialtyAction,
  setContactArchivedAction,
  updateAssignmentAction,
  updateContactAction,
  verifyContactAction,
} from "../actions";
import { ContactFields } from "../contact-fields";
import { CONTACT_ROLES, contactRoleLabel } from "@/lib/contact-roles";
import { ProductOptions } from "@/components/line-picker";

const ACTIVITY_TYPES = ["NOTE", "CALL", "MEETING", "EMAIL", "VISIT", "OTHER"];

export async function generateMetadata({ params }: PageProps<"/contacts/[id]">) {
  const ctx = await requireAuth();
  try {
    const c = await getContact(ctx, (await params).id);
    return { title: `${c.firstName} ${c.lastName}` };
  } catch {
    return { title: "Contact" };
  }
}

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const ctx = await requireAuth();
  const { id } = await params;
  let contact;
  try {
    contact = await getContact(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const write = can(ctx, "contact.write");
  const [carriers, channels, territories, products, others, activity, history] = await Promise.all([
    listCarrierOptions(ctx),
    listAllChannels(ctx),
    listTerritories(ctx),
    listProducts(ctx),
    listContactOptions(ctx),
    listContactActivity(ctx, id),
    can(ctx, "audit.read") ? listContactHistory(ctx, id) : Promise.resolve([]),
  ]);
  const otherContacts = others.filter((o) => o.id !== id);
  const assignedOrgs = [...new Map(contact.assignments.map((a) => [a.organization.id, a.organization])).values()];

  return (
    <>
      <Link href="/contacts" className="back-link">← Contacts</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">{contact.firstName} {contact.lastName}</h1>
        {contact.status !== "ACTIVE" && <Badge>Inactive</Badge>}
        {contact.archivedAt && <Badge tone="bad">Archived</Badge>}
        <FreshnessBadge f={contact.freshness} />
      </div>

      <Section title="Confirm still current">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Last confirmed: {contact.verifiedAt ? fmtDateTime(contact.verifiedAt) : "never"}. Contacts are due for review {contact.cadenceDays} days after confirmation.
        </p>
        {write && (
          <ActionForm action={verifyContactAction.bind(null, id)} submitLabel="Confirm still current" className="flex flex-wrap items-end gap-3">
            <Field label="How did you confirm?" htmlFor="sourceNote" hint="e.g. Called the office; carrier rep list dated 2026-10">
              <input id="sourceNote" name="sourceNote" required maxLength={500} className={`${inputClass} min-w-72`} />
            </Field>
          </ActionForm>
        )}
        {contact.verifications.length > 0 && (
          <ul className="text-xs text-zinc-600 dark:text-zinc-400">
            {contact.verifications.map((v) => <li key={v.id}>{fmtDateTime(v.verifiedAt)} · {v.verifiedBy.name} · {v.sourceNote}</li>)}
          </ul>
        )}
      </Section>

      <Section title="Details">
        {write ? (
          <ActionForm action={updateContactAction.bind(null, id)} submitLabel="Save changes">
            <ContactFields d={contact} />
          </ActionForm>
        ) : (
          <p className="text-sm">{contact.email ?? "No email"} · {contact.officePhone ?? "No phone"}</p>
        )}
      </Section>

      <Section title="Assignments">
        {contact.assignments.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">No assignments yet.</p>}
        <ul className="flex flex-col gap-3">
          {contact.assignments.map((a) => (
            <li key={a.id} className={`flex flex-col gap-2 rounded-xl border p-3 text-sm dark:border-zinc-700 ${a.current ? "border-zinc-200" : "border-dashed border-zinc-300 text-zinc-600 dark:text-zinc-400"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <strong>{contactRoleLabel(a.role)}</strong>
                {a.title && <span>({a.title})</span>}
                <span>at</span>
                <Link href={`/carriers/${a.organization.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{a.organization.displayName}</Link>
                <span>· {a.territory?.name ?? "Territory not recorded"}</span>
                {a.marketChannel && <span>· {a.marketChannel.carrierProduct.product.name}{a.marketChannel.intermediary ? ` via ${a.marketChannel.intermediary.displayName}` : ""}</span>}
                <span className="text-zinc-600 dark:text-zinc-400">{fmtDate(a.effectiveFrom)} → {a.effectiveTo ? fmtDate(a.effectiveTo) : "open"}</span>
                {!a.current && <Badge>{a.effectiveTo ? "Ended" : "Not yet started"}</Badge>}
              </div>
              {a.backupContact && <div>Backup: <Link href={`/contacts/${a.backupContact.id}`} className="hover:underline">{a.backupContact.firstName} {a.backupContact.lastName}</Link></div>}
              {a.authorityNotes && <p className="whitespace-pre-wrap">Authority: {a.authorityNotes}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <span>Specialties:</span>
                {a.specialties.length === 0 && <span className="text-zinc-600 dark:text-zinc-400">none recorded</span>}
                {a.specialties.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1">
                    <Badge>{s.product.line.name}: {s.product.name}{s.industryCode && ` · ${s.industryCode}`}</Badge>
                    {write && (
                      <ActionForm action={removeSpecialtyAction.bind(null, id, s.id)} submitLabel="×" variant="secondary" showOk={false} className="inline">{null}</ActionForm>
                    )}
                  </span>
                ))}
              </div>
              {write && a.current && (
                <details>
                  <summary className="cursor-pointer text-blue-800 dark:text-blue-300">Edit, add a specialty, or end this assignment</summary>
                  <div className="mt-2 flex flex-col gap-3">
                    <ActionForm action={updateAssignmentAction.bind(null, id, a.id)} submitLabel="Save" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Field label="Title" htmlFor={`t-${a.id}`}><input id={`t-${a.id}`} name="title" defaultValue={a.title ?? ""} className={inputClass} /></Field>
                      <Field label="Backup contact" htmlFor={`b-${a.id}`}>
                        <select id={`b-${a.id}`} name="backupContactId" defaultValue={a.backupContactId ?? ""} className={inputClass}>
                          <option value="">None</option>
                          {otherContacts.map((o) => <option key={o.id} value={o.id}>{o.firstName} {o.lastName}</option>)}
                        </select>
                      </Field>
                      <Field label="Authority notes" htmlFor={`n-${a.id}`}><input id={`n-${a.id}`} name="authorityNotes" defaultValue={a.authorityNotes ?? ""} className={inputClass} /></Field>
                    </ActionForm>
                    <ActionForm action={addSpecialtyAction.bind(null, id, a.id)} submitLabel="Add specialty" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Field label="Product" htmlFor={`p-${a.id}`}>
                        <select id={`p-${a.id}`} name="productId" required className={inputClass}>
                          <ProductOptions products={products} />
                        </select>
                      </Field>
                      <Field label="Industry code (optional)" htmlFor={`i-${a.id}`} hint="e.g. NAICS 238160"><input id={`i-${a.id}`} name="industryCode" maxLength={40} className={inputClass} /></Field>
                    </ActionForm>
                    <ActionForm action={endAssignmentAction.bind(null, id, a.id)} submitLabel="End assignment" variant="secondary" className="flex flex-wrap items-end gap-2">
                      <Field label="Last day" htmlFor={`e-${a.id}`}><input id={`e-${a.id}`} name="effectiveTo" type="date" required className={inputClass} /></Field>
                    </ActionForm>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
        {write && (
          <ActionForm action={addAssignmentAction.bind(null, id)} submitLabel="Add assignment" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Carrier or intermediary" htmlFor="aOrg">
              <select id="aOrg" name="organizationId" required className={inputClass}>
                {carriers.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
            </Field>
            <Field label="Role" htmlFor="aRole">
              <select id="aRole" name="role" required className={inputClass}>
                {CONTACT_ROLES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Territory" htmlFor="aTerr" hint="Choose United States for nationwide">
              <select id="aTerr" name="territoryId" className={inputClass}>
                <option value="">Not recorded</option>
                {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Channel (optional)" htmlFor="aCh" hint="Must belong to the carrier chosen">
              <select id="aCh" name="marketChannelId" className={inputClass}>
                <option value="">Any / not specific</option>
                {channels.map((c) => <option key={c.id} value={c.id}>{channelLabel(c)}</option>)}
              </select>
            </Field>
            <Field label="Title" htmlFor="aTitle"><input id="aTitle" name="title" maxLength={120} className={inputClass} /></Field>
            <Field label="Backup contact" htmlFor="aBackup">
              <select id="aBackup" name="backupContactId" className={inputClass}>
                <option value="">None</option>
                {otherContacts.map((o) => <option key={o.id} value={o.id}>{o.firstName} {o.lastName}</option>)}
              </select>
            </Field>
            <Field label="Starts (optional)" htmlFor="aFrom"><input id="aFrom" name="effectiveFrom" type="date" className={inputClass} /></Field>
            <Field label="Authority notes" htmlFor="aAuth" hint="e.g. Binds up to $1M GL; refers habitational"><input id="aAuth" name="authorityNotes" maxLength={2000} className={inputClass} /></Field>
          </ActionForm>
        )}
      </Section>

      {contact.backupFor.length > 0 && (
        <Section title="Backup for">
          <ul className="text-sm">
            {contact.backupFor.map((b) => (
              <li key={b.id}><Link href={`/contacts/${b.contact.id}`} className="hover:underline">{b.contact.firstName} {b.contact.lastName}</Link> at {b.organization.displayName}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Activity and notes">
        {write && assignedOrgs.length > 0 && (
          <ActionForm action={addContactActivityAction.bind(null, id)} submitLabel="Add note">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="About" htmlFor="nOrg">
                <select id="nOrg" name="organizationId" className={inputClass}>
                  {assignedOrgs.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
                </select>
              </Field>
              <Field label="Type" htmlFor="nType">
                <select id="nType" name="type" className={inputClass}>
                  {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Note" htmlFor="nNotes"><textarea id="nNotes" name="notes" required rows={3} maxLength={5000} className={inputClass} /></Field>
          </ActionForm>
        )}
        {write && assignedOrgs.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">Add an assignment first; notes are filed under a carrier.</p>}
        {activity.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">No activity yet.</p> : (
          <ol className="flex flex-col gap-3">
            {activity.map((n) => (
              <li key={n.id} className="border-l-2 border-zinc-300 pl-3 text-sm dark:border-zinc-600">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">{label(n.type)} · {fmtDateTime(n.occurredAt)} · {n.owner.name} · {n.organization.displayName}</div>
                <p className="whitespace-pre-wrap">{n.notes}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {can(ctx, "audit.read") && (
        <Section title="Change history"><HistoryTable events={history} /></Section>
      )}

      {write && (
        <Section title={contact.archivedAt ? "Restore" : "Archive"}>
          <ActionForm
            action={setContactArchivedAction.bind(null, id, !contact.archivedAt)}
            submitLabel={contact.archivedAt ? "Restore contact" : "Archive contact"}
            variant={contact.archivedAt ? "secondary" : "danger"}
            confirm={contact.archivedAt ? undefined : "Archive this contact? Their history is kept."}
          >
            {null}
          </ActionForm>
        </Section>
      )}
    </>
  );
}
