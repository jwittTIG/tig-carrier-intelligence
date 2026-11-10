import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { listContactsForCarrier, listTerritories } from "@/server/services/contacts";
import { ActionForm } from "@/components/action-form";
import { addContactToCarrierAction } from "../../contacts/actions";
import { FreshnessBadge } from "@/components/freshness";
import { Badge, Field, Section, inputClass } from "@/components/ui";
import { CONTACT_ROLES, contactRoleLabel } from "@/lib/contact-roles";

export async function ContactsTab({ carrierId }: { carrierId: string }) {
  const ctx = await requireAuth();
  const write = can(ctx, "contact.write");
  const [rows, territories] = await Promise.all([listContactsForCarrier(ctx, carrierId), write ? listTerritories(ctx) : Promise.resolve([])]);
  const current = rows.filter((r) => r.current);
  const past = rows.filter((r) => !r.current);
  return (
    <Section
      title="Contacts"
    >
      {rows.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">No contacts at this carrier yet.</p>}
      {current.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-600 dark:text-zinc-400">
              <tr><th scope="col" className="py-1 pr-3">Name</th><th scope="col" className="py-1 pr-3">Role</th><th scope="col" className="py-1 pr-3">Territory</th><th scope="col" className="py-1 pr-3">Lines</th><th scope="col" className="py-1">Confirmed</th></tr>
            </thead>
            <tbody>
              {current.map((a) => (
                <tr key={a.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-1 pr-3">
                    <Link href={`/contacts/${a.contact.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{a.contact.firstName} {a.contact.lastName}</Link>
                    {a.contact.status !== "ACTIVE" && <span className="text-zinc-600 dark:text-zinc-400"> (inactive)</span>}
                    {a.contact.email && <div className="text-xs text-zinc-600 dark:text-zinc-400">{a.contact.email}</div>}
                  </td>
                  <td className="py-1 pr-3">{contactRoleLabel(a.role)}{a.title && <div className="text-xs text-zinc-600 dark:text-zinc-400">{a.title}</div>}</td>
                  <td className="py-1 pr-3">{a.territory?.name ?? "Not recorded"}</td>
                  <td className="py-1 pr-3">{a.specialties.map((s) => s.product.name).join(", ") || "—"}</td>
                  <td className="py-1"><FreshnessBadge f={a.freshness} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">{past.length} past or future {past.length === 1 ? "assignment" : "assignments"}</summary>
          <ul className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {past.map((a) => (
              <li key={a.id}>
                <Link href={`/contacts/${a.contact.id}`} className="hover:underline">{a.contact.firstName} {a.contact.lastName}</Link> · {contactRoleLabel(a.role)} · {a.territory?.name ?? "—"} <Badge>{a.effectiveTo ? "Ended" : "Not yet started"}</Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
      {write && (
        <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
          <h3 className="text-sm font-medium">Add a contact</h3>
          <ActionForm action={addContactToCarrierAction.bind(null, carrierId)} submitLabel="Add contact" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Type of contact" htmlFor="ccRole">
              <select id="ccRole" name="role" required defaultValue="" className={inputClass}>
                <option value="" disabled>Choose…</option>
                {CONTACT_ROLES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="First name" htmlFor="ccFirst"><input id="ccFirst" name="firstName" required maxLength={80} className={inputClass} /></Field>
            <Field label="Last name" htmlFor="ccLast"><input id="ccLast" name="lastName" required maxLength={80} className={inputClass} /></Field>
            <Field label="Email" htmlFor="ccEmail"><input id="ccEmail" name="email" type="email" maxLength={200} className={inputClass} /></Field>
            <Field label="Office phone" htmlFor="ccOffice"><input id="ccOffice" name="officePhone" maxLength={40} className={inputClass} /></Field>
            <Field label="Mobile phone" htmlFor="ccMobile"><input id="ccMobile" name="mobilePhone" maxLength={40} className={inputClass} /></Field>
            <Field label="Job title (optional)" htmlFor="ccTitle"><input id="ccTitle" name="title" maxLength={120} className={inputClass} /></Field>
            <Field label="Territory (optional)" htmlFor="ccTerr">
              <select id="ccTerr" name="territoryId" defaultValue="" className={inputClass}>
                <option value="">Not recorded</option>
                {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </ActionForm>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">To add someone who already works with another carrier, open their contact page and assign them here instead. Lines they handle are added on their contact page.</p>
        </div>
      )}
    </Section>
  );
}
