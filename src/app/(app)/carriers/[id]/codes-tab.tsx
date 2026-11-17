import { requireAuth } from "@/server/auth/session";
import { channelLabel, codeTargets, listAgencyEntities, listCodesForCarrier, listPortals } from "@/server/services/appointments";
import { listActiveUsers } from "@/server/services/users";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, Section, inputClass, label } from "@/components/ui";
import { addCodesAction, addPortalAction, removePortalAction, updateCodeAction } from "../appointment-actions";
import { showControl } from "@/server/auth/view";

const CODE_TYPES = ["MASTER", "PRODUCER", "SUB_CODE", "LOCATION", "OTHER"];

/** Agency codes and portal links for a carrier: a reference only. Appointments are managed by corporate. */
export async function CodesTab({ carrierId }: { carrierId: string }) {
  const ctx = await requireAuth();
  const write = (await showControl(ctx, "appointment.write"));
  const [codes, targets, entities, portals, users] = await Promise.all([
    listCodesForCarrier(ctx, carrierId),
    codeTargets(ctx, carrierId),
    listAgencyEntities(ctx),
    listPortals(ctx, carrierId),
    listActiveUsers(ctx),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Section title="Agency and producer codes">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">For looking codes up. Appointments themselves are managed by TIG&apos;s corporate office, not here.</p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-600 dark:text-zinc-400">
              <tr>
                <th scope="col" className="py-1 pr-2">Code</th>
                <th scope="col" className="py-1 pr-2">Type</th>
                <th scope="col" className="py-1 pr-2">Product and channel</th>
                {entities.length > 1 && <th scope="col" className="py-1 pr-2">Agency entity</th>}
                <th scope="col" className="py-1 pr-2">Producer</th>
                <th scope="col" className="py-1 pr-2">Notes</th>
                <th scope="col" className="py-1 pr-2">In use</th>
                <th scope="col" className="py-1"><span className="sr-only">Edit</span></th>
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 && <tr><td colSpan={8} className="py-1 text-zinc-600 dark:text-zinc-400">No codes recorded for this carrier.</td></tr>}
              {codes.map((c) => (
                <tr key={c.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-1 pr-2 font-mono">{c.codeValue}</td>
                  <td className="py-1 pr-2">{label(c.codeType)}</td>
                  <td className="py-1 pr-2">{channelLabel(c.appointment.marketChannel)}</td>
                  {entities.length > 1 && <td className="py-1 pr-2">{c.appointment.agencyEntity.organization.displayName}</td>}
                  <td className="py-1 pr-2">{c.assignedUser?.name ?? "—"}</td>
                  <td className="py-1 pr-2">{c.notes ?? ""}</td>
                  <td className="py-1 pr-2">{c.inUse ? <Badge tone="good">In use</Badge> : <Badge>Not in use</Badge>}</td>
                  <td className="py-1">
                    {write && (
                      <details>
                        <summary className="cursor-pointer text-blue-800 dark:text-blue-300">Edit<span className="sr-only"> code {c.codeValue}</span></summary>
                        <ActionForm action={updateCodeAction.bind(null, carrierId, c.id)} submitLabel="Save" className="mt-2 grid grid-cols-1 gap-2">
                          <Field label="Producer" htmlFor={`cu-${c.id}`}>
                            <select id={`cu-${c.id}`} name="assignedUserId" defaultValue={c.assignedUserId ?? ""} className={inputClass}>
                              <option value="">None</option>
                              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          </Field>
                          <Field label="In use" htmlFor={`cs-${c.id}`}>
                            <select id={`cs-${c.id}`} name="status" defaultValue={c.status} className={inputClass}>
                              <option value="ACTIVE">Yes</option>
                              <option value="INACTIVE">No</option>
                            </select>
                          </Field>
                          <Field label="Notes" htmlFor={`cn-${c.id}`}><input id={`cn-${c.id}`} name="notes" defaultValue={c.notes ?? ""} className={inputClass} /></Field>
                        </ActionForm>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Changes are recorded in the carrier&apos;s change history. To change a code&apos;s value, mark it not in use and add the new one.</p>
        {write && targets.length > 0 && entities.length > 0 && (
          <ActionForm action={addCodesAction.bind(null, carrierId)} submitLabel="Add code" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <fieldset className="sm:col-span-3">
              <legend className="text-sm font-medium">Lines it&apos;s for</legend>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">Tick All lines for a code used across the carrier, or just the lines it applies to.</p>
              {targets.length > 1 && (
                <label className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="targets" value="all" /> All lines ({targets.length})
                </label>
              )}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {targets.map((t) => (
                  <label key={t.value} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="targets" value={t.value} defaultChecked={targets.length === 1} /> {t.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {entities.length > 1 && (
              <Field label="Agency entity" htmlFor="ncEnt">
                <select id="ncEnt" name="agencyEntityId" required className={inputClass}>{entities.map((e) => <option key={e.id} value={e.id}>{e.organization.displayName}</option>)}</select>
              </Field>
            )}
            <Field label="Code" htmlFor="ncVal"><input id="ncVal" name="codeValue" required maxLength={60} className={inputClass} /></Field>
            <Field label="Type" htmlFor="ncType">
              <select id="ncType" name="codeType" className={inputClass}>{CODE_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>
            </Field>
            <Field label="Producer (optional)" htmlFor="ncUser">
              <select id="ncUser" name="assignedUserId" className={inputClass}>
                <option value="">None</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Notes (optional)" htmlFor="ncNotes"><input id="ncNotes" name="notes" maxLength={1000} className={inputClass} /></Field>
          </ActionForm>
        )}
        {write && targets.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">To add a code, first add the lines this carrier writes on the Writing companies &amp; channels tab.</p>}
        {write && targets.length > 0 && entities.length === 0 && <p role="alert" className="text-sm text-red-700 dark:text-red-400">Codes need the agency set up (the agency entity), and none is active. Ask an admin to set it up.</p>}
      </Section>

      <Section title="Other portal links">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          The main login is the carrier portal site in the carrier&apos;s details. Add other sites here (billing, claims, a wholesaler&apos;s portal). Never store passwords: keep logins in the password manager and note where to find them.
        </p>
        {portals.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">No portal links.</p> : (
          <ul className="flex flex-col gap-2 text-sm">
            {portals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3">
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-zinc-900 hover:text-blue-700 dark:text-zinc-100 dark:hover:text-blue-300">{p.name}</a>
                {p.credentialVaultReference && <span className="text-zinc-600 dark:text-zinc-400">Login: {p.credentialVaultReference}</span>}
                {p.accessInstructions && <span className="text-zinc-600 dark:text-zinc-400">{p.accessInstructions}</span>}
                {write && <ActionForm action={removePortalAction.bind(null, carrierId, p.id)} submitLabel="Remove" variant="danger" showOk={false} confirm={`Remove ${p.name}?`}>{null}</ActionForm>}
              </li>
            ))}
          </ul>
        )}
        {write && (
          <ActionForm action={addPortalAction.bind(null, carrierId)} submitLabel="Add portal link" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Name" htmlFor="pName"><input id="pName" name="name" required maxLength={120} className={inputClass} /></Field>
            <Field label="URL" htmlFor="pUrl"><input id="pUrl" name="url" type="url" required placeholder="https://" className={inputClass} /></Field>
            <Field label="Where the login lives" htmlFor="pVault" hint="e.g. Password manager › Carriers › Summit"><input id="pVault" name="credentialVaultReference" maxLength={200} className={inputClass} /></Field>
            <Field label="Instructions (optional)" htmlFor="pInstr"><input id="pInstr" name="accessInstructions" maxLength={1000} className={inputClass} /></Field>
          </ActionForm>
        )}
      </Section>
    </div>
  );
}
