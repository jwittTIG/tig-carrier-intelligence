import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getProfile } from "@/server/services/appetite";
import { listTerritories } from "@/server/services/contacts";
import { listCitableVersions } from "@/server/services/documents";
import { listSources } from "@/server/services/sources";
import { listActiveUsers } from "@/server/services/users";
import { ActionForm } from "@/components/action-form";
import { FreshnessBadge } from "@/components/freshness";
import { AddSourceForm, DecisionPanel, OutcomeBadge, SourcesList, StatusBadge } from "@/components/m4";
import { Badge, Field, Section, fmtDate, fmtDateTime, inputClass, label } from "@/components/ui";
import {
  addAttributeAction,
  addCoverageAction,
  addRequirementAction,
  addRuleAction,
  deleteDraftAction,
  newVersionAction,
  removeCoverageAction,
  removeRequirementAction,
  removeRuleAction,
  submitProfileAction,
  updateProfileAction,
  verifyProfileAction,
  withdrawProfileAction,
} from "../../m4-actions";

const OUTCOMES = ["PREFERRED", "ACCEPTED", "REFERRAL", "PROHIBITED", "UNKNOWN"];
const OPERATORS = ["EQ", "NEQ", "LT", "LTE", "GT", "GTE", "BETWEEN", "IN", "NOT_IN", "EXISTS"];
const OPERATOR_LABEL: Record<string, string> = { EQ: "=", NEQ: "≠", LT: "<", LTE: "≤", GT: ">", GTE: "≥", BETWEEN: "between", IN: "is one of", NOT_IN: "is not one of", EXISTS: "is present" };
const DATA_TYPES = ["MONEY", "NUMBER", "INTEGER", "TEXT", "BOOLEAN", "DATE", "ENUM"];

function valueText(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const o = v as { value?: string; min?: string; max?: string; values?: string[] };
  if (o.values) return o.values.join(", ");
  if (o.min !== undefined) return `${o.min} to ${o.max}`;
  return o.value ?? "";
}

export async function generateMetadata({ params }: PageProps<"/appetite/[id]">) {
  const ctx = await requireAuth();
  try {
    const p = await getProfile(ctx, (await params).id);
    return { title: `Appetite: ${p.carrierProduct.writingCompany.displayName} v${p.version}` };
  } catch {
    return { title: "Appetite" };
  }
}

export default async function AppetiteProfilePage({ params }: PageProps<"/appetite/[id]">) {
  const ctx = await requireAuth();
  const { id } = await params;
  let p;
  try {
    p = await getProfile(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [territories, versions, users, sources] = await Promise.all([
    listTerritories(ctx),
    listCitableVersions(ctx),
    listActiveUsers(ctx),
    listSources(ctx, "APPETITE_PROFILE", id),
  ]);
  const write = can(ctx, "appetite.write");
  const draft = p.status === "DRAFT";
  const path = `/appetite/${id}`;
  const cp = p.carrierProduct;
  const ruleIdx = new Map(p.rules.map((r, i) => [r.id, i + 1]));

  return (
    <>
      <Link href={`/carriers/${cp.writingCompany.id}?tab=appetite`} className="text-sm hover:underline">← {cp.writingCompany.displayName}</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{cp.product.name} · v{p.version}</h1>
        <StatusBadge status={p.status} />
        {p.freshness && <FreshnessBadge f={p.freshness} />}
      </div>
      <p className="-mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {cp.writingCompany.displayName} · {cp.product.line.name}
        {p.marketChannel && ` · via ${p.marketChannel.intermediary?.displayName ?? label(p.marketChannel.distributionType)}`}
        {" · "}effective {fmtDate(p.effectiveFrom)} → {p.effectiveTo ? fmtDate(p.effectiveTo) : "open"}
        {" · "}owner {p.owner?.name ?? "none"}
        {p.approvedBy && ` · approved by ${p.approvedBy.name} ${fmtDateTime(p.approvedAt!)}`}
      </p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Appetite is a guide, not a commitment to quote or bind, and not binding authority. Confirm eligibility with the underwriter.</p>

      {p.pending && <DecisionPanel ctx={ctx} cr={p.pending} permission="appetite.approve" returnTo={path} />}

      {p.conflicts.length > 0 && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
          <strong>Possible conflicts:</strong>
          <ul className="list-disc pl-5">{p.conflicts.map((c) => <li key={`${c.a}-${c.b}`}>Rules {ruleIdx.get(c.a)} and {ruleIdx.get(c.b)}: {c.reason}.</li>)}</ul>
        </div>
      )}

      <Section title="Versions">
        <ul className="flex flex-wrap gap-2 text-sm">
          {p.versions.map((v) => (
            <li key={v.id}>
              {v.id === id ? <strong>v{v.version}</strong> : <Link href={`/appetite/${v.id}`} className="text-blue-800 hover:underline dark:text-blue-300">v{v.version}</Link>}{" "}
              <StatusBadge status={v.status} /> <span className="text-xs text-zinc-600 dark:text-zinc-400">{fmtDate(v.effectiveFrom)} → {v.effectiveTo ? fmtDate(v.effectiveTo) : "open"}</span>
            </li>
          ))}
        </ul>
        {write && (p.status === "APPROVED" || p.status === "RETIRED") && (
          <ActionForm action={newVersionAction.bind(null, id)} submitLabel="Start a new version" variant="secondary" showOk={false}>{null}</ActionForm>
        )}
      </Section>

      {draft && write && (
        <Section title="Draft settings">
          <ActionForm action={updateProfileAction.bind(null, id)} submitLabel="Save" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Effective from" htmlFor="pFrom"><input id="pFrom" name="effectiveFrom" type="date" defaultValue={p.effectiveFrom ? fmtDate(p.effectiveFrom) : ""} className={inputClass} /></Field>
            <Field label="Ends (optional)" htmlFor="pTo"><input id="pTo" name="effectiveTo" type="date" defaultValue={p.effectiveTo ? fmtDate(p.effectiveTo) : ""} className={inputClass} /></Field>
            <Field label="Owner" htmlFor="pOwner">
              <select id="pOwner" name="ownerUserId" defaultValue={p.ownerUserId ?? ""} className={inputClass}>
                <option value="">None</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
          </ActionForm>
          <div className="flex flex-wrap gap-3">
            <ActionForm action={submitProfileAction.bind(null, id)} submitLabel="Submit for approval" className="flex flex-wrap items-end gap-2">
              <Field label="Note for the reviewer (optional)" htmlFor="subNote"><input id="subNote" name="note" maxLength={1000} className={`${inputClass} min-w-64`} /></Field>
            </ActionForm>
            <ActionForm action={deleteDraftAction.bind(null, id, cp.writingCompany.id)} submitLabel="Delete draft" variant="danger" showOk={false} confirm="Delete this draft and its rules?">{null}</ActionForm>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">To submit: an owner, an effective date, at least one rule, and at least one source.</p>
        </Section>
      )}
      {p.status === "PENDING" && p.pending?.proposedById === ctx.userId && (
        <ActionForm action={withdrawProfileAction.bind(null, id)} submitLabel="Withdraw submission" variant="secondary">{null}</ActionForm>
      )}

      <Section title={`Rules (${p.rules.length})`}>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">A rule with no states applies in every state, and one with no industry codes applies to every industry. &ldquo;Unknown&rdquo; is never treated as eligible.</p>
        {p.rules.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">No rules yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-600 dark:text-zinc-400">
                <tr><th scope="col" className="py-1 pr-2">#</th><th scope="col" className="py-1 pr-2">Outcome</th><th scope="col" className="py-1 pr-2">States</th><th scope="col" className="py-1 pr-2">Industries</th><th scope="col" className="py-1 pr-2">Condition</th><th scope="col" className="py-1 pr-2">Dates</th><th scope="col" className="py-1 pr-2">Why</th><th scope="col" className="py-1"><span className="sr-only">Remove</span></th></tr>
              </thead>
              <tbody>
                {p.rules.map((r, i) => (
                  <tr key={r.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2"><OutcomeBadge outcome={r.outcome} /></td>
                    <td className="py-1 pr-2">{r.territories.length ? r.territories.map((t) => t.territory.stateCode ?? t.territory.name).join(", ") : "All"}</td>
                    <td className="py-1 pr-2">{r.industries.length ? r.industries.map((x) => `${x.classificationSystem} ${x.code}`).join(", ") : "All"}</td>
                    <td className="py-1 pr-2">{r.attributeDefinition ? `${r.attributeDefinition.label} ${OPERATOR_LABEL[r.operator!]} ${valueText(r.typedValue)}${r.attributeDefinition.unit ? ` ${r.attributeDefinition.unit}` : ""}` : "—"}</td>
                    <td className="py-1 pr-2">{r.effectiveFrom || r.effectiveTo ? `${fmtDate(r.effectiveFrom)} → ${r.effectiveTo ? fmtDate(r.effectiveTo) : "open"}` : "Profile dates"}</td>
                    <td className="py-1 pr-2">{r.rationale ?? ""}</td>
                    <td className="py-1">{draft && write && <ActionForm action={removeRuleAction.bind(null, id, r.id)} submitLabel="Remove" variant="secondary" showOk={false}>{null}</ActionForm>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {draft && write && (
          <details>
            <summary className="cursor-pointer text-sm text-blue-800 dark:text-blue-300">Add a rule</summary>
            <ActionForm action={addRuleAction.bind(null, id)} submitLabel="Add rule" className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Outcome" htmlFor="rOutcome">
                <select id="rOutcome" name="outcome" className={inputClass}>{OUTCOMES.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select>
              </Field>
              <Field label="States (leave empty for all)" htmlFor="rTerr" hint="Ctrl/Cmd-click to pick several">
                <select id="rTerr" name="territoryIds" multiple size={6} className={inputClass}>
                  {territories.filter((t) => t.stateCode).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Industry codes (optional)" htmlFor="rInd" hint="e.g. NAICS 238160, ISO_GL 91111">
                <input id="rInd" name="industries" maxLength={500} className={inputClass} />
              </Field>
              <Field label="Attribute (optional)" htmlFor="rAttr">
                <select id="rAttr" name="attributeDefinitionId" className={inputClass}>
                  <option value="">None</option>
                  {cp.product.attributeDefinitions.map((a) => <option key={a.id} value={a.id}>{a.label}{a.unit ? ` (${a.unit})` : ""}</option>)}
                </select>
              </Field>
              <Field label="Compare" htmlFor="rOp">
                <select id="rOp" name="operator" className={inputClass}>
                  <option value="">—</option>
                  {OPERATORS.map((o) => <option key={o} value={o}>{OPERATOR_LABEL[o]}</option>)}
                </select>
              </Field>
              <Field label="Value" htmlFor="rVal" hint='e.g. 5,000,000 · "1,000,000 to 5,000,000" · "TN, KY"'><input id="rVal" name="value" maxLength={500} className={inputClass} /></Field>
              <Field label="Starts (optional)" htmlFor="rFrom"><input id="rFrom" name="effectiveFrom" type="date" className={inputClass} /></Field>
              <Field label="Ends (optional)" htmlFor="rTo"><input id="rTo" name="effectiveTo" type="date" className={inputClass} /></Field>
              <Field label="Why / guide wording" htmlFor="rWhy"><input id="rWhy" name="rationale" maxLength={2000} className={inputClass} /></Field>
            </ActionForm>
          </details>
        )}
        {write && (
          <details>
            <summary className="cursor-pointer text-sm text-blue-800 dark:text-blue-300">Define an attribute for {cp.product.name}</summary>
            <ActionForm action={addAttributeAction.bind(null, id, cp.productId)} submitLabel="Define attribute" className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="Key" htmlFor="aKey" hint="e.g. annual_revenue"><input id="aKey" name="key" required className={inputClass} /></Field>
              <Field label="Label" htmlFor="aLabel"><input id="aLabel" name="label" required className={inputClass} /></Field>
              <Field label="Type" htmlFor="aType"><select id="aType" name="dataType" className={inputClass}>{DATA_TYPES.map((d) => <option key={d} value={d}>{label(d)}</option>)}</select></Field>
              <Field label="Unit (optional)" htmlFor="aUnit"><input id="aUnit" name="unit" placeholder="USD" className={inputClass} /></Field>
            </ActionForm>
          </details>
        )}
      </Section>

      <Section title="Sources">
        <SourcesList sources={sources} />
        {draft && write && <AddSourceForm returnTo={path} recordType="APPETITE_PROFILE" recordId={id} versions={versions} />}
      </Section>

      {p.status === "APPROVED" && (
        <Section title="Confirm still current">
          <p className="text-sm">Last confirmed {p.verifiedAt ? fmtDateTime(p.verifiedAt) : "never"}; next review {fmtDate(p.nextReviewAt)}.</p>
          {write && (
            <ActionForm action={verifyProfileAction.bind(null, id)} submitLabel="Confirm still current" className="flex flex-wrap items-end gap-2">
              <Field label="How did you confirm?" htmlFor="vNote"><input id="vNote" name="sourceNote" required maxLength={500} className={`${inputClass} min-w-72`} /></Field>
            </ActionForm>
          )}
          {p.verifications.length > 0 && <ul className="text-xs text-zinc-600 dark:text-zinc-400">{p.verifications.map((v) => <li key={v.id}>{fmtDateTime(v.verifiedAt)} · {v.verifiedBy.name} · {v.sourceNote}</li>)}</ul>}
        </Section>
      )}

      <Section title={`Limits and requirements for ${cp.product.name} (all versions)`}>
        <h3 className="text-sm font-medium">Coverage limits offered</h3>
        {cp.coverages.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">None recorded. Missing limits are &ldquo;not stated&rdquo;, never &ldquo;no limit&rdquo;.</p> : (
          <ul className="text-sm">
            {cp.coverages.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <strong>{c.coverageCode}</strong> min {c.minLimit?.toString() ?? "not stated"} · max {c.maxLimit?.toString() ?? "not stated"} {c.currency}
                {write && <ActionForm action={removeCoverageAction.bind(null, id, cp.id, c.id)} submitLabel="Remove" variant="secondary" showOk={false}>{null}</ActionForm>}
              </li>
            ))}
          </ul>
        )}
        {write && (
          <ActionForm action={addCoverageAction.bind(null, id, cp.id)} submitLabel="Add limit" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Coverage" htmlFor="cCode" hint="e.g. GL each occurrence"><input id="cCode" name="coverageCode" required className={inputClass} /></Field>
            <Field label="Minimum (optional)" htmlFor="cMin"><input id="cMin" name="minLimit" inputMode="decimal" className={inputClass} /></Field>
            <Field label="Maximum (optional)" htmlFor="cMax"><input id="cMax" name="maxLimit" inputMode="decimal" className={inputClass} /></Field>
          </ActionForm>
        )}
        <h3 className="mt-2 text-sm font-medium">Underwriting requirements</h3>
        {cp.requirements.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">None recorded.</p> : (
          <ul className="text-sm">
            {cp.requirements.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <Badge>{r.requirementType}</Badge> {r.description}
                {r.sourceDocumentVersion && <span className="text-xs text-zinc-600 dark:text-zinc-400">({r.sourceDocumentVersion.document.title} v{r.sourceDocumentVersion.versionNumber})</span>}
                {write && <ActionForm action={removeRequirementAction.bind(null, id, cp.id, r.id)} submitLabel="Remove" variant="secondary" showOk={false}>{null}</ActionForm>}
              </li>
            ))}
          </ul>
        )}
        {write && (
          <ActionForm action={addRequirementAction.bind(null, id, cp.id)} submitLabel="Add requirement" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Kind" htmlFor="qType" hint="e.g. Application, Loss runs, Supplemental"><input id="qType" name="requirementType" required className={inputClass} /></Field>
            <Field label="Description" htmlFor="qDesc"><input id="qDesc" name="description" required className={inputClass} /></Field>
            <Field label="Source document (optional)" htmlFor="qDoc">
              <select id="qDoc" name="sourceDocumentVersionId" className={inputClass}>
                <option value="">—</option>
                {versions.map((v) => <option key={v.id} value={v.id}>{v.document.title} v{v.versionNumber}</option>)}
              </select>
            </Field>
          </ActionForm>
        )}
      </Section>
    </>
  );
}
