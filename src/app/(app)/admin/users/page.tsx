import Link from "next/link";
import { can } from "@/server/auth/context";
import { ROLES } from "@/server/auth/catalog";
import { requireAuth } from "@/server/auth/session";
import { allowedDomains, listUsers } from "@/server/services/users";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, Section, inputClass, label } from "@/components/ui";
import { inviteUserAction, setActiveAction, setRoleAction } from "./actions";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const ctx = await requireAuth();
  if (!can(ctx, "admin.users")) return <p role="alert">Only admins can manage users.</p>;
  const users = await listUsers(ctx);
  const domains = allowedDomains();

  return (
    <>
      <Link href="/setup" className="text-sm hover:underline">← Setup</Link>
      <h1 className="text-xl font-semibold">Users</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Everyone sees all carrier information, including commissions and codes (DECISIONS D1). Admins can also manage users and settings.
        People sign in with their Microsoft 365 account and must be invited first.
      </p>

      <Section title="Invite someone">
        <ActionForm action={inviteUserAction} submitLabel="Invite" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Name" htmlFor="inviteName"><input id="inviteName" name="name" required maxLength={120} className={inputClass} /></Field>
          <Field label="Work email" htmlFor="inviteEmail" hint={domains.length ? `Allowed: ${domains.map((d) => "@" + d).join(", ")}` : "No email domains are configured"}>
            <input id="inviteEmail" name="email" type="email" required className={inputClass} />
          </Field>
          <Field label="Role" htmlFor="inviteRole">
            <select id="inviteRole" name="role" defaultValue="STAFF" className={inputClass}>
              {ROLES.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
          </Field>
        </ActionForm>
      </Section>

      <div className="overflow-x-auto rounded-2xl border border-transparent bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-600 dark:text-zinc-400 dark:border-zinc-700">
            <tr>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">Email</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Role</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">{u.name}{u.id === ctx.userId && <span className="text-zinc-600 dark:text-zinc-400"> (you)</span>}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">
                  <Badge tone={u.status === "ACTIVE" ? "good" : u.status === "INVITED" ? "warn" : "bad"}>{label(u.status)}</Badge>
                  {u.status === "INVITED" && <div className="text-xs text-zinc-600 dark:text-zinc-400">Not signed in yet</div>}
                </td>
                <td className="px-3 py-2">
                  <ActionForm action={setRoleAction.bind(null, u.id)} submitLabel="Set" variant="secondary" className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.name}</label>
                    <select id={`role-${u.id}`} name="role" defaultValue={u.role ?? ""} className={`${inputClass} w-auto`}>
                      {!u.role && <option value="">No role</option>}
                      {ROLES.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                    </select>
                  </ActionForm>
                </td>
                <td className="px-3 py-2">
                  {u.id !== ctx.userId && (
                    <ActionForm
                      action={setActiveAction.bind(null, u.id, u.status === "DEACTIVATED")}
                      submitLabel={u.status === "DEACTIVATED" ? "Reactivate" : "Deactivate"}
                      variant={u.status === "DEACTIVATED" ? "secondary" : "danger"}
                      confirm={u.status === "DEACTIVATED" ? undefined : `Deactivate ${u.name}? They will lose access immediately.`}
                    >
                      {null}
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
