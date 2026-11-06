import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { channelLabel, listAgencyEntities, listAppointmentsForCarrier, listChannelsForOrg, listPortals } from "@/server/services/appointments";
import { listProducts } from "@/server/services/carriers";
import { listTerritories } from "@/server/services/contacts";
import { listActiveUsers } from "@/server/services/users";
import { ActionForm } from "@/components/action-form";
import { EffectiveBadge } from "@/components/freshness";
import { Field, Section, fmtDate, inputClass, label } from "@/components/ui";
import {
  addAuthorizationAction,
  addCodeAction,
  addPortalAction,
  createAppointmentAction,
  removeAuthorizationAction,
  removePortalAction,
  updateAppointmentAction,
  updateCodeAction,
} from "../appointment-actions";

const APPOINTMENT_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "TERMINATED"];
const CODE_TYPES = ["MASTER", "PRODUCER", "SUB_CODE", "LOCATION", "OTHER"];

export async function AppointmentsTab({ carrierId }: { carrierId: string }) {
  const ctx = await requireAuth();
  const write = can(ctx, "appointment.write");
  const [appointments, channels, entities, portals, territories, products, users] = await Promise.all([
    listAppointmentsForCarrier(ctx, carrierId),
    listChannelsForOrg(ctx, carrierId),
    listAgencyEntities(ctx),
    listPortals(ctx, carrierId),
    listTerritories(ctx),
    listProducts(ctx),
    listActiveUsers(ctx),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Section title="Portal links">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Never store passwords here. Keep logins in the password manager and note where to find them.
        </p>
        {portals.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">No portal links.</p> : (
          <ul className="flex flex-col gap-2 text-sm">
            {portals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3">
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-800 hover:underline dark:text-blue-300">{p.name}</a>
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

      <Section title="Appointments and codes">
        {appointments.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">No appointments recorded for this carrier.</p>}
        <ul className="flex flex-col gap-4">
          {appointments.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-700">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{channelLabel(a.marketChannel)}</strong>
                <span>· {a.agencyEntity.organization.displayName}</span>
                <span>· {a.appointmentType}</span>
                <EffectiveBadge state={a.state} />
                {a.state === "NOT_ACTIVE" && <span className="text-zinc-600 dark:text-zinc-400">({label(a.status)})</span>}
                <span className="text-zinc-600 dark:text-zinc-400">{fmtDate(a.effectiveFrom)} → {a.effectiveTo ? fmtDate(a.effectiveTo) : "open"}</span>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase text-zinc-600 dark:text-zinc-400">Authorized for</h3>
                {a.authorizations.length === 0 ? <p className="text-zinc-600 dark:text-zinc-400">No states or products recorded.</p> : (
                  <ul className="flex flex-wrap gap-2">
                    {a.authorizations.map((z) => (
                      <li key={z.id} className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
                        {z.territory.name} · {z.product.name} · {z.authorityType}
                        {write && <ActionForm action={removeAuthorizationAction.bind(null, carrierId, a.id, z.id)} submitLabel="×" variant="secondary" showOk={false} className="inline">{null}</ActionForm>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="overflow-x-auto">
                <h3 className="text-xs font-semibold uppercase text-zinc-600 dark:text-zinc-400">Codes</h3>
                <table className="w-full text-left">
                  <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                    <tr><th scope="col" className="py-1 pr-2">Code</th><th scope="col" className="py-1 pr-2">Type</th><th scope="col" className="py-1 pr-2">Producer</th><th scope="col" className="py-1 pr-2">Dates</th><th scope="col" className="py-1 pr-2">Status</th><th scope="col" className="py-1"><span className="sr-only">Edit</span></th></tr>
                  </thead>
                  <tbody>
                    {a.codes.length === 0 && <tr><td colSpan={6} className="py-1 text-zinc-600 dark:text-zinc-400">No codes.</td></tr>}
                    {a.codes.map((c) => (
                      <tr key={c.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                        <td className="py-1 pr-2 font-mono">{c.codeValue}</td>
                        <td className="py-1 pr-2">{label(c.codeType)}</td>
                        <td className="py-1 pr-2">{c.assignedUser?.name ?? "—"}</td>
                        <td className="py-1 pr-2">{fmtDate(c.effectiveFrom)} → {c.effectiveTo ? fmtDate(c.effectiveTo) : "open"}</td>
                        <td className="py-1 pr-2"><EffectiveBadge state={c.state} /></td>
                        <td className="py-1">
                          {write && (
                            <details>
                              <summary className="cursor-pointer text-blue-800 dark:text-blue-300">Edit</summary>
                              <ActionForm action={updateCodeAction.bind(null, carrierId, a.id, c.id)} submitLabel="Save" className="mt-2 grid grid-cols-1 gap-2">
                                <Field label="Producer" htmlFor={`cu-${c.id}`}>
                                  <select id={`cu-${c.id}`} name="assignedUserId" defaultValue={c.assignedUserId ?? ""} className={inputClass}>
                                    <option value="">None</option>
                                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                                  </select>
                                </Field>
                                <Field label="Ends" htmlFor={`ce-${c.id}`}><input id={`ce-${c.id}`} name="effectiveTo" type="date" defaultValue={c.effectiveTo ? fmtDate(c.effectiveTo) : ""} className={inputClass} /></Field>
                                <Field label="Status" htmlFor={`cs-${c.id}`}>
                                  <select id={`cs-${c.id}`} name="status" defaultValue={c.status} className={inputClass}>
                                    <option value="ACTIVE">Active</option>
                                    <option value="INACTIVE">Inactive</option>
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
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Changes to codes are recorded in the carrier&apos;s change history. To change a code&apos;s value, end it and add the new one.</p>
              </div>

              {write && (
                <details>
                  <summary className="cursor-pointer text-blue-800 dark:text-blue-300">Add a code, an authorization, or update this appointment</summary>
                  <div className="mt-2 flex flex-col gap-3">
                    <ActionForm action={addCodeAction.bind(null, carrierId, a.id)} submitLabel="Add code" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Field label="Code" htmlFor={`nc-${a.id}`}><input id={`nc-${a.id}`} name="codeValue" required maxLength={60} className={inputClass} /></Field>
                      <Field label="Type" htmlFor={`nt-${a.id}`}>
                        <select id={`nt-${a.id}`} name="codeType" className={inputClass}>{CODE_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>
                      </Field>
                      <Field label="Producer (optional)" htmlFor={`nu-${a.id}`}>
                        <select id={`nu-${a.id}`} name="assignedUserId" className={inputClass}>
                          <option value="">None</option>
                          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Effective from" htmlFor={`nf-${a.id}`}><input id={`nf-${a.id}`} name="effectiveFrom" type="date" required className={inputClass} /></Field>
                      <Field label="Ends (optional)" htmlFor={`ne-${a.id}`}><input id={`ne-${a.id}`} name="effectiveTo" type="date" className={inputClass} /></Field>
                      <Field label="Notes" htmlFor={`nn-${a.id}`}><input id={`nn-${a.id}`} name="notes" maxLength={1000} className={inputClass} /></Field>
                    </ActionForm>
                    <ActionForm action={addAuthorizationAction.bind(null, carrierId, a.id)} submitLabel="Add authorization" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Field label="State" htmlFor={`as-${a.id}`}>
                        <select id={`as-${a.id}`} name="territoryId" required className={inputClass}>{territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                      </Field>
                      <Field label="Product" htmlFor={`ap-${a.id}`}>
                        <select id={`ap-${a.id}`} name="productId" required defaultValue={a.marketChannel.carrierProduct.product.id} className={inputClass}>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.line.name}: {p.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Authority" htmlFor={`at-${a.id}`} hint="e.g. Quote and bind; Submit only">
                        <input id={`at-${a.id}`} name="authorityType" required maxLength={80} className={inputClass} />
                      </Field>
                    </ActionForm>
                    <ActionForm action={updateAppointmentAction.bind(null, carrierId, a.id)} submitLabel="Update appointment" className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <Field label="Type" htmlFor={`ut-${a.id}`}><input id={`ut-${a.id}`} name="appointmentType" defaultValue={a.appointmentType} required className={inputClass} /></Field>
                      <Field label="Status" htmlFor={`us-${a.id}`}>
                        <select id={`us-${a.id}`} name="status" defaultValue={a.status} className={inputClass}>{APPOINTMENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
                      </Field>
                      <Field label="From" htmlFor={`uf-${a.id}`}><input id={`uf-${a.id}`} name="effectiveFrom" type="date" defaultValue={a.effectiveFrom ? fmtDate(a.effectiveFrom) : ""} className={inputClass} /></Field>
                      <Field label="To" htmlFor={`ue-${a.id}`}><input id={`ue-${a.id}`} name="effectiveTo" type="date" defaultValue={a.effectiveTo ? fmtDate(a.effectiveTo) : ""} className={inputClass} /></Field>
                    </ActionForm>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>

        {write && channels.length > 0 && entities.length > 0 && (
          <ActionForm action={createAppointmentAction.bind(null, carrierId)} submitLabel="Add appointment" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Channel" htmlFor="apCh">
              <select id="apCh" name="marketChannelId" required className={inputClass}>{channels.map((c) => <option key={c.id} value={c.id}>{channelLabel(c)}</option>)}</select>
            </Field>
            <Field label="Agency entity" htmlFor="apEnt">
              <select id="apEnt" name="agencyEntityId" required className={inputClass}>{entities.map((e) => <option key={e.id} value={e.id}>{e.organization.displayName}</option>)}</select>
            </Field>
            <Field label="Appointment type" htmlFor="apType" hint="e.g. Direct appointment; Broker agreement">
              <input id="apType" name="appointmentType" required maxLength={80} className={inputClass} />
            </Field>
            <Field label="Status" htmlFor="apStatus">
              <select id="apStatus" name="status" defaultValue="PENDING" className={inputClass}>{APPOINTMENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
            </Field>
            <Field label="Effective from" htmlFor="apFrom" hint="Required when active"><input id="apFrom" name="effectiveFrom" type="date" className={inputClass} /></Field>
            <Field label="Ends (optional)" htmlFor="apTo"><input id="apTo" name="effectiveTo" type="date" className={inputClass} /></Field>
          </ActionForm>
        )}
        {write && channels.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">Add a product and channel on the Writing companies &amp; channels tab first.</p>}
      </Section>
    </div>
  );
}
