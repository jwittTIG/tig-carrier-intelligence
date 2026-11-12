import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { listProfilesForCarrier } from "@/server/services/appetite";
import { channelLabel, listAgencyEntities, listChannelsForOrg } from "@/server/services/appointments";
import { fractionToPercent, listAgreementsForCarrier } from "@/server/services/commissions";
import { listCitableVersions, listDocuments } from "@/server/services/documents";
import { listCarrierUpdates } from "@/server/services/inbox-options";
import { guideAppetite } from "@/server/services/extractions";
import { aiStatus, listGuides } from "@/server/services/guides";
import { GuideAppetiteRow } from "../../extractions/guide-appetite";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/m4";
import { Badge, Field, Section, fmtDate, fmtDateTime, inputClass, label } from "@/components/ui";
import { createAgreementAction, createProfileAction, deleteDraftAction } from "../../m4-actions";
import { UploadForm } from "../../documents/upload-form";

type Carrier = { id: string; carrierProducts: { id: string; archivedAt: Date | null; product: { name: string }; channels: { id: string; archivedAt: Date | null; distributionType: string; intermediary: { displayName: string } | null }[] }[] };

export async function AppetiteTab({ carrier }: { carrier: Carrier }) {
  const ctx = await requireAuth();
  const profiles = await listProfilesForCarrier(ctx, carrier.id);
  const products = carrier.carrierProducts.filter((p) => !p.archivedAt);
  const canRead = can(ctx, "document.read");
  const canWriteAppetite = can(ctx, "appetite.write");
  const canApprove = canWriteAppetite && can(ctx, "appetite.approve");
  const canWrite = aiStatus().mode !== "off" && can(ctx, "appetite.write") && canRead;
  const guides = canRead ? (await listGuides(ctx, carrier.id)).filter((g) => g.readable) : [];
  const states = guides.length ? await guideAppetite(ctx, guides) : new Map();
  const targets = products.map((p) => ({ id: p.id, label: p.product.name }));
  return (
    <>
    {(guides.length > 0 || canWrite) && (
      <Section title="Appetite from guides (AI)">
        {guides.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">Upload a PDF appetite guide or underwriting guidelines on the Documents tab first.</p>}
        {guides.length > 0 && (
          <>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">Each guide is drafted into its product&apos;s appetite once. Upload a new version on the guide&apos;s page and AI reads it automatically; its draft replaces what the earlier version drafted (hand-added rules are kept).</p>
            <ul className="flex flex-col gap-4">
              {guides.map((g) => (
                <li key={g.documentVersionId}>
                  <GuideAppetiteRow guide={g} state={states.get(g.documentId)} targets={targets} canWrite={canWrite} showTitle />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    )}
    <Section title="Appetite profiles">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Appetite is a guide, not a commitment to quote or bind. Each product (or product + channel) has numbered versions; only one draft at a time.</p>
      {profiles.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">No appetite recorded for this carrier.</p>}
      {profiles.length > 0 && (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-600 dark:text-zinc-400">
            <tr><th scope="col" className="py-1 pr-3">Product</th><th scope="col" className="py-1 pr-3">Version</th><th scope="col" className="py-1 pr-3">Status</th><th scope="col" className="py-1 pr-3">Effective</th><th scope="col" className="py-1 pr-3">Rules</th><th scope="col" className="py-1 pr-3">Review</th><th scope="col" className="py-1"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 pr-3">
                  <Link href={`/appetite/${p.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{p.carrierProduct.product.name}</Link>
                  {p.marketChannel?.intermediary && <span className="text-zinc-600 dark:text-zinc-400"> via {p.marketChannel.intermediary.displayName}</span>}
                  {p.carrierProduct.writingCompany.id !== carrier.id && <span className="text-zinc-600 dark:text-zinc-400"> ({p.carrierProduct.writingCompany.displayName})</span>}
                </td>
                <td className="py-1 pr-3">v{p.version}</td>
                <td className="py-1 pr-3"><StatusBadge status={p.status} /></td>
                <td className="py-1 pr-3">{fmtDate(p.effectiveFrom)} → {p.effectiveTo ? fmtDate(p.effectiveTo) : "open"}</td>
                <td className="py-1 pr-3">{p._count.rules}</td>
                <td className="py-1 pr-3">{p.stale ? <Badge tone="warn">Review overdue</Badge> : p.nextReviewAt ? fmtDate(p.nextReviewAt) : "—"}</td>
                <td className="py-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {p.status === "DRAFT" && p._count.rules > 0 && <Link href={`/appetite/${p.id}#approve`} className="font-medium text-zinc-900 hover:text-blue-700 dark:text-zinc-100 dark:hover:text-blue-300">Approve…</Link>}
                    {p.status === "PENDING" && <Link href={`/appetite/${p.id}`} className="font-medium text-zinc-900 hover:text-blue-700 dark:text-zinc-100 dark:hover:text-blue-300">Review…</Link>}
                    {p.status === "APPROVED" && canApprove && <Link href={`/appetite/${p.id}?closeout=1#close-out`} className="text-blue-800 hover:underline dark:text-blue-300">Close out…</Link>}
                    {p.status === "DRAFT" && p._count.rules === 0 && canWriteAppetite && (
                      <ActionForm action={deleteDraftAction.bind(null, p.id, carrier.id)} submitLabel="Delete" submitHint={`empty draft ${p.carrierProduct.product.name} v${p.version}`} variant="secondary" showOk={false} confirm={`Delete the empty ${p.carrierProduct.product.name} draft?`}>{null}</ActionForm>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {can(ctx, "appetite.write") && products.length > 0 && (
        <ActionForm action={createProfileAction.bind(null, carrier.id)} submitLabel="Start appetite profile" showOk={false} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Product" htmlFor="apProd">
            <select id="apProd" name="carrierProductId" className={inputClass}>{products.map((p) => <option key={p.id} value={p.id}>{p.product.name}</option>)}</select>
          </Field>
          <Field label="Channel (optional)" htmlFor="apChan" hint="Only if appetite differs by channel; must be on that product">
            <select id="apChan" name="marketChannelId" className={inputClass}>
              <option value="">All channels</option>
              {products.flatMap((p) => p.channels.filter((c) => !c.archivedAt).map((c) => <option key={c.id} value={c.id}>{p.product.name}: {c.intermediary ? `via ${c.intermediary.displayName}` : label(c.distributionType)}</option>))}
            </select>
          </Field>
          <Field label="Effective from (optional)" htmlFor="apFrom"><input id="apFrom" name="effectiveFrom" type="date" className={inputClass} /></Field>
        </ActionForm>
      )}
      {products.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">Appetite is recorded on products this carrier writes. Add a product on the Writing companies &amp; channels tab.</p>}
    </Section>
    </>
  );
}

export async function CommissionsTab({ carrierId }: { carrierId: string }) {
  const ctx = await requireAuth();
  if (!can(ctx, "commission.read")) return <p className="text-sm">You don&apos;t have permission to view commissions.</p>;
  const [agreements, channels, entities, versions] = await Promise.all([listAgreementsForCarrier(ctx, carrierId), listChannelsForOrg(ctx, carrierId), listAgencyEntities(ctx), listCitableVersions(ctx)]);
  return (
    <Section title="Commission agreements" actions={<a href="/api/v1/commission-schedules?format=csv" className="text-sm text-blue-800 hover:underline dark:text-blue-300">All schedules (CSV)</a>}>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Restricted: commission information.</p>
      {agreements.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">No commission agreements recorded.</p>}
      <ul className="flex flex-col gap-3">
        {agreements.map((a) => (
          <li key={a.id} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-700">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/commissions/${a.id}`} className="font-medium text-zinc-900 hover:text-blue-700 dark:text-zinc-100 dark:hover:text-blue-300">{a.agreementRef ?? "Agreement"}</Link>
              <span>· {channelLabel(a.marketChannel)} · {a.agencyEntity.organization.displayName}</span>
              <StatusBadge status={a.status} />
            </div>
            {a.currentSchedules.length === 0 ? <p className="text-zinc-600 dark:text-zinc-400">No schedule in effect today.</p> : (
              <ul className="mt-1">
                {a.currentSchedules.map((s) => (
                  <li key={s.id}>{s.product.name} · {label(s.transactionType)} · {s.territory?.name ?? "All states"}: <strong>{s.basis === "RATE" ? fractionToPercent(s.rate) : s.basis === "FLAT" ? `$${s.flatAmount?.toFixed(2)} flat` : "Tiered"}</strong> since {fmtDate(s.effectiveFrom)}</li>
                ))}
              </ul>
            )}
            {a.contingencyNotes && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Contingency: {a.contingencyNotes}</p>}
          </li>
        ))}
      </ul>
      {can(ctx, "commission.write") && channels.length > 0 && entities.length > 0 && (
        <ActionForm action={createAgreementAction.bind(null, carrierId)} submitLabel="Add agreement" showOk={false} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Channel" htmlFor="caCh"><select id="caCh" name="marketChannelId" className={inputClass}>{channels.map((c) => <option key={c.id} value={c.id}>{channelLabel(c)}</option>)}</select></Field>
          <Field label="Agency entity" htmlFor="caEnt"><select id="caEnt" name="agencyEntityId" className={inputClass}>{entities.map((e) => <option key={e.id} value={e.id}>{e.organization.displayName}</option>)}</select></Field>
          <Field label="Reference (optional)" htmlFor="caRef"><input id="caRef" name="agreementRef" className={inputClass} /></Field>
          <Field label="Signed agreement (optional now)" htmlFor="caDoc">
            <select id="caDoc" name="sourceDocumentVersionId" className={inputClass}>
              <option value="">—</option>
              {versions.map((v) => <option key={v.id} value={v.id}>{v.document.title} v{v.versionNumber}</option>)}
            </select>
          </Field>
        </ActionForm>
      )}
    </Section>
  );
}

export async function DocumentsTab({ carrierId }: { carrierId: string }) {
  const ctx = await requireAuth();
  const docs = await listDocuments(ctx, { organizationId: carrierId });
  return (
    <Section title="Documents filed under this carrier">
      {docs.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">No documents.</p> : (
        <ul className="text-sm">
          {docs.map((d) => (
            <li key={d.id}>
              <Link href={`/documents/${d.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{d.title}</Link>
              {" "}<Badge>{label(d.documentType)}</Badge>{d.classification === "RESTRICTED" && <> <Badge tone="warn">Restricted</Badge></>}
              {d.latest && <span className="text-xs text-zinc-600 dark:text-zinc-400"> · v{d.latest.versionNumber} · {fmtDateTime(d.latest.uploadedAt)}</span>}
            </li>
          ))}
        </ul>
      )}
      {can(ctx, "document.write") && <UploadForm organizationId={carrierId} returnTo={`/carriers/${carrierId}`} />}
    </Section>
  );
}

export async function UpdatesTab({ carrierId }: { carrierId: string }) {
  const ctx = await requireAuth();
  if (!can(ctx, "inbox.read")) return <p className="text-sm">You don&apos;t have permission to view the inbox.</p>;
  const items = await listCarrierUpdates(ctx, carrierId);
  return (
    <Section title="Updates by email">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Bulletins and guideline emails forwarded to the carrier-updates mailbox and filed under this carrier.</p>
      {items.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">None yet.</p> : (
        <ul className="text-sm">
          {items.map((m) => (
            <li key={m.id}>
              <Link href={`/inbox/${m.id}`} className="text-blue-800 dark:text-blue-300">{m.subject}</Link>
              <span className="text-xs text-zinc-600 dark:text-zinc-400"> · {fmtDateTime(m.receivedAt)} · {m.originalFrom ?? m.fromAddress}{m._count.attachments ? ` · ${m._count.attachments} file(s)` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
