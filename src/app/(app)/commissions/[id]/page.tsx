import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listProducts } from "@/server/services/carriers";
import { fractionToPercent, getAgreement } from "@/server/services/commissions";
import { listTerritories } from "@/server/services/contacts";
import { listCitableVersions } from "@/server/services/documents";
import { listSources } from "@/server/services/sources";
import { ActionForm } from "@/components/action-form";
import { AddSourceForm, DecisionPanel, SourcesList, StatusBadge } from "@/components/m4";
import { Badge, Field, Section, fmtDate, fmtDateTime, inputClass, label } from "@/components/ui";
import { ProductOptions } from "@/components/line-picker";
import {
  addScheduleAction,
  addTierAction,
  deleteScheduleAction,
  retireScheduleAction,
  submitAgreementAction,
  submitScheduleAction,
  updateAgreementAction,
  withdrawCommissionAction,
} from "../../m4-actions";
import { showControl } from "@/server/auth/view";

const TX = ["NEW", "RENEWAL", "ENDORSEMENT", "OTHER"];

export const metadata = { title: "Commission agreement" };

export default async function AgreementPage({ params }: PageProps<"/commissions/[id]">) {
  const ctx = await requireAuth();
  if (!can(ctx, "commission.read")) return <p role="alert">You don&apos;t have permission to view commissions.</p>;
  const { id } = await params;
  let a;
  try {
    a = await getAgreement(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
  const [products, territories, versions, sources] = await Promise.all([listProducts(ctx), listTerritories(ctx), listCitableVersions(ctx), listSources(ctx, "COMMISSION_AGREEMENT", id)]);
  const write = (await showControl(ctx, "commission.write"));
  const canRetire = await showControl(ctx, "commission.approve");
  const path = `/commissions/${id}`;
  const ch = a.marketChannel;
  const agreementPending = a.pending.find((p) => p.recordType === "COMMISSION_AGREEMENT");
  const states = territories.filter((t) => t.stateCode);

  return (
    <>
      <Link href={`/carriers/${ch.carrierProduct.writingCompany.id}?tab=commissions`} className="back-link">← {ch.carrierProduct.writingCompany.displayName}</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">Commission agreement{a.agreementRef && ` ${a.agreementRef}`}</h1>
        <StatusBadge status={a.status} />
      </div>
      <p className="-mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {ch.carrierProduct.writingCompany.displayName}: {ch.carrierProduct.product.name}{ch.intermediary ? ` via ${ch.intermediary.displayName}` : " (direct)"} · {a.agencyEntity.organization.displayName}
        {a.approvedBy && ` · approved by ${a.approvedBy.name} ${fmtDateTime(a.approvedAt!)}`}
      </p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Restricted: commission information. Rates are as agreed in the source document; this app doesn&apos;t calculate or reconcile commissions.</p>

      {agreementPending && <DecisionPanel ctx={ctx} cr={agreementPending} permission="commission.approve" returnTo={path} />}

      <Section title="Agreement">
        <p className="text-sm">
          Signed agreement:{" "}
          {a.sourceDocumentVersion ? <Link href={`/documents/${a.sourceDocumentVersion.document.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{a.sourceDocumentVersion.document.title} v{a.sourceDocumentVersion.versionNumber}</Link> : <span className="text-amber-700">not attached (needed before approval)</span>}
        </p>
        {write ? (
          <ActionForm action={updateAgreementAction.bind(null, id)} submitLabel="Save">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {a.status === "DRAFT" && (
                <>
                  <Field label="Agreement reference" htmlFor="agRef"><input id="agRef" name="agreementRef" defaultValue={a.agreementRef ?? ""} className={inputClass} /></Field>
                  <Field label="Signed agreement document" htmlFor="agDoc">
                    <select id="agDoc" name="sourceDocumentVersionId" defaultValue={a.sourceDocumentVersionId ?? ""} className={inputClass}>
                      <option value="">—</option>
                      {versions.map((v) => <option key={v.id} value={v.id}>{v.document.title} v{v.versionNumber}</option>)}
                    </select>
                  </Field>
                </>
              )}
              <Field label="Contingency / profit-sharing notes" htmlFor="agCont" hint="Terms as described in the agreement. No payout calculation.">
                <textarea id="agCont" name="contingencyNotes" rows={3} defaultValue={a.contingencyNotes ?? ""} className={inputClass} />
              </Field>
              <Field label="Notes" htmlFor="agNotes"><textarea id="agNotes" name="notes" rows={3} defaultValue={a.notes ?? ""} className={inputClass} /></Field>
            </div>
          </ActionForm>
        ) : (
          <>
            {a.contingencyNotes && <p className="whitespace-pre-wrap text-sm">Contingency: {a.contingencyNotes}</p>}
            {a.notes && <p className="whitespace-pre-wrap text-sm">{a.notes}</p>}
          </>
        )}
        {write && a.status === "DRAFT" && (
          <ActionForm action={submitAgreementAction.bind(null, id)} submitLabel="Submit agreement for approval" variant="secondary" className="flex flex-wrap items-end gap-2">
            <Field label="Note (optional)" htmlFor="agSub"><input id="agSub" name="note" className={`${inputClass} min-w-64`} /></Field>
          </ActionForm>
        )}
        {agreementPending?.proposedById === ctx.userId && (
          <ActionForm action={withdrawCommissionAction.bind(null, id, "COMMISSION_AGREEMENT", id)} submitLabel="Withdraw submission" variant="secondary">{null}</ActionForm>
        )}
        <h3 className="text-sm font-medium">Other sources</h3>
        <SourcesList sources={sources} />
        {write && <AddSourceForm returnTo={path} recordType="COMMISSION_AGREEMENT" recordId={id} versions={versions} uploadLabel={(await showControl(ctx, "document.write")) ? "Upload a document" : undefined} />}
      </Section>

      <Section title="Schedules" actions={<a href={`/api/v1/commission-schedules?agreementId=${id}&format=csv`} className="text-sm text-blue-800 hover:underline dark:text-blue-300">Download CSV</a>}>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">An approved schedule never changes. To change a rate, add a new schedule with a later start date; when it&apos;s approved, the old one ends the day before.</p>
        {a.schedules.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">No schedules yet.</p>}
        <ul className="flex flex-col gap-3">
          {a.schedules.map((s) => (
            <li key={s.id} id={`schedule-${s.id}`} className={`flex flex-col gap-2 rounded-xl border p-3 text-sm dark:border-zinc-700 ${s.current ? "border-green-300" : "border-zinc-200"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <strong>{s.product.name}</strong>
                <span>· {label(s.transactionType)}</span>
                <span>· {s.territory?.name ?? "All states"}</span>
                <span>· {s.basis === "RATE" ? fractionToPercent(s.rate) : s.basis === "FLAT" ? `$${s.flatAmount?.toFixed(2)} flat` : "Tiered"}</span>
                <span className="text-zinc-600 dark:text-zinc-400">{fmtDate(s.effectiveFrom)} → {s.effectiveTo ? fmtDate(s.effectiveTo) : "open"}</span>
                <StatusBadge status={s.status} />
                {s.current && <Badge tone="good">In effect today</Badge>}
              </div>
              {s.tiers.length > 0 && (
                <ul className="text-xs">
                  {s.tiers.map((t) => <li key={t.id}>${t.thresholdMin.toFixed(2)} – {t.thresholdMax ? `$${t.thresholdMax.toFixed(2)}` : "and up"}: {t.rate ? fractionToPercent(t.rate) : `$${t.flatAmount?.toFixed(2)}`}</li>)}
                </ul>
              )}
              {s.notes && <p className="text-xs">{s.notes}</p>}
              {s.pending && <DecisionPanel ctx={ctx} cr={s.pending} permission="commission.approve" returnTo={path} />}
              {write && s.status === "DRAFT" && (
                <div className="flex flex-wrap items-end gap-3">
                  {s.basis === "TIERED" && (
                    <ActionForm action={addTierAction.bind(null, id, s.id)} submitLabel="Add tier" className="flex flex-wrap items-end gap-2">
                      <Field label="From $" htmlFor={`tf-${s.id}`}><input id={`tf-${s.id}`} name="thresholdMin" required inputMode="decimal" className={`${inputClass} w-28`} /></Field>
                      <Field label="To $ (optional)" htmlFor={`tt-${s.id}`}><input id={`tt-${s.id}`} name="thresholdMax" inputMode="decimal" className={`${inputClass} w-28`} /></Field>
                      <Field label="Rate %" htmlFor={`tr-${s.id}`}><input id={`tr-${s.id}`} name="ratePercent" inputMode="decimal" className={`${inputClass} w-20`} /></Field>
                      <Field label="or flat $" htmlFor={`ta-${s.id}`}><input id={`ta-${s.id}`} name="flatAmount" inputMode="decimal" className={`${inputClass} w-24`} /></Field>
                    </ActionForm>
                  )}
                  <ActionForm action={submitScheduleAction.bind(null, id, s.id)} submitLabel="Submit for approval" className="flex flex-wrap items-end gap-2">{null}</ActionForm>
                  <ActionForm action={deleteScheduleAction.bind(null, id, s.id)} submitLabel="Delete draft" variant="danger" showOk={false} confirm="Delete this draft schedule?">{null}</ActionForm>
                </div>
              )}
              {s.pending?.proposedById === ctx.userId && (
                <ActionForm action={withdrawCommissionAction.bind(null, id, "COMMISSION_SCHEDULE", s.id)} submitLabel="Withdraw submission" variant="secondary">{null}</ActionForm>
              )}
              {s.status === "APPROVED" && canRetire && (
                <details>
                  <summary className="cursor-pointer text-xs text-blue-800 dark:text-blue-300">Retire this schedule</summary>
                  <ActionForm action={retireScheduleAction.bind(null, id, s.id)} submitLabel="Retire" variant="danger" className="mt-2 flex flex-wrap items-end gap-2">
                    <Field label="Last day" htmlFor={`re-${s.id}`}><input id={`re-${s.id}`} name="effectiveTo" type="date" className={inputClass} /></Field>
                    <Field label="Reason" htmlFor={`rr-${s.id}`}><input id={`rr-${s.id}`} name="reason" required minLength={5} className={inputClass} /></Field>
                  </ActionForm>
                </details>
              )}
            </li>
          ))}
        </ul>
        {write && a.status !== "RETIRED" && (
          <details>
            <summary className="cursor-pointer text-sm text-blue-800 dark:text-blue-300">Add a schedule</summary>
            <ActionForm action={addScheduleAction.bind(null, id)} submitLabel="Add draft schedule" className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="Product" htmlFor="sProd">
                <select id="sProd" name="productId" defaultValue={ch.carrierProduct.productId} className={inputClass}>
                  <ProductOptions products={products} />
                </select>
              </Field>
              <Field label="Transaction" htmlFor="sTx"><select id="sTx" name="transactionType" className={inputClass}>{TX.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></Field>
              <Field label="State" htmlFor="sTerr">
                <select id="sTerr" name="territoryId" className={inputClass}>
                  <option value="">All states</option>
                  {states.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Basis" htmlFor="sBasis">
                <select id="sBasis" name="basis" className={inputClass}><option value="RATE">Rate (%)</option><option value="FLAT">Flat amount</option><option value="TIERED">Tiered</option></select>
              </Field>
              <Field label="Rate %" htmlFor="sRate" hint="e.g. 12.5"><input id="sRate" name="ratePercent" inputMode="decimal" className={inputClass} /></Field>
              <Field label="Flat amount $" htmlFor="sFlat"><input id="sFlat" name="flatAmount" inputMode="decimal" className={inputClass} /></Field>
              <Field label="Effective from" htmlFor="sFrom"><input id="sFrom" name="effectiveFrom" type="date" required className={inputClass} /></Field>
              <Field label="Ends (optional)" htmlFor="sTo"><input id="sTo" name="effectiveTo" type="date" className={inputClass} /></Field>
              <Field label="Notes" htmlFor="sNotes"><input id="sNotes" name="notes" className={inputClass} /></Field>
            </ActionForm>
          </details>
        )}
      </Section>
    </>
  );
}
