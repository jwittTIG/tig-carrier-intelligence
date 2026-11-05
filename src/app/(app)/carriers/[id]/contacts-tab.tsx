import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { listContactsForCarrier } from "@/server/services/contacts";
import { FreshnessBadge } from "@/components/freshness";
import { Badge, Section, label } from "@/components/ui";

export async function ContactsTab({ carrierId }: { carrierId: string }) {
  const ctx = await requireAuth();
  const rows = await listContactsForCarrier(ctx, carrierId);
  const current = rows.filter((r) => r.current);
  const past = rows.filter((r) => !r.current);
  return (
    <Section
      title="Contacts"
      actions={can(ctx, "contact.write") ? <Link href="/contacts/new" className="text-sm text-blue-800 hover:underline dark:text-blue-300">New contact</Link> : undefined}
    >
      {rows.length === 0 && <p className="text-sm text-zinc-500">No contacts assigned to this carrier. Add one from the Contacts page.</p>}
      {current.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr><th scope="col" className="py-1 pr-3">Name</th><th scope="col" className="py-1 pr-3">Role</th><th scope="col" className="py-1 pr-3">Territory</th><th scope="col" className="py-1 pr-3">Lines</th><th scope="col" className="py-1">Confirmed</th></tr>
            </thead>
            <tbody>
              {current.map((a) => (
                <tr key={a.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-1 pr-3">
                    <Link href={`/contacts/${a.contact.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{a.contact.firstName} {a.contact.lastName}</Link>
                    {a.contact.status !== "ACTIVE" && <span className="text-zinc-500"> (inactive)</span>}
                    {a.contact.email && <div className="text-xs text-zinc-500">{a.contact.email}</div>}
                  </td>
                  <td className="py-1 pr-3">{label(a.role)}{a.title && <div className="text-xs text-zinc-500">{a.title}</div>}</td>
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
          <ul className="mt-2 text-sm text-zinc-500">
            {past.map((a) => (
              <li key={a.id}>
                <Link href={`/contacts/${a.contact.id}`} className="hover:underline">{a.contact.firstName} {a.contact.lastName}</Link> · {label(a.role)} · {a.territory?.name ?? "—"} <Badge>{a.effectiveTo ? "Ended" : "Not yet started"}</Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
