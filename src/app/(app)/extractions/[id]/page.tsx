import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getExtraction } from "@/server/services/extractions";
import { ActionForm } from "@/components/action-form";
import { OutcomeBadge } from "@/components/m4";
import { Badge, Section, fmtDateTime, label } from "@/components/ui";
import { applyExtractionAction, retrySkippedAction } from "../actions";

export const metadata = { title: "Review AI draft" };

const OPS: Record<string, string> = { EQ: "is", NEQ: "is not", IN: "is one of", NOT_IN: "is not one of", LT: "<", LTE: "≤", GT: ">", GTE: "≥", BETWEEN: "between", EXISTS: "is present" };

function Evidence({ versionId, item }: { versionId: string; item: { page: number; quote: string; confidence: number } }) {
  // Below 80%: the AI is unsure or simplified the guide's wording (e.g. a rule that applies only with another condition).
  const low = item.confidence < 0.8;
  return (
    <div className="flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-400">
      <blockquote className="italic">“{item.quote}”</blockquote>
      <span className="flex flex-wrap items-center gap-2">
        <a href={`/api/v1/document-versions/${versionId}/download?view=1#page=${item.page}`} target="_blank" rel="noopener noreferrer" className="text-blue-800 hover:underline dark:text-blue-300">
          Page {item.page} <span aria-hidden="true">↗</span><span className="sr-only"> (opens the guide in a new tab)</span>
        </a>
        {low ? <Badge tone="warn">Check this ({Math.round(item.confidence * 100)}% sure; may be simplified)</Badge> : <span>confidence {Math.round(item.confidence * 100)}%</span>}
      </span>
    </div>
  );
}

function Pick({ name, index, children }: { name: string; index: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 border-t border-zinc-100 py-2 first:border-0 dark:border-zinc-800">
      <input type="checkbox" name={name} value={index} defaultChecked id={`${name}-${index}`} className="mt-1 h-4 w-4 shrink-0 accent-blue-700" />
      <label htmlFor={`${name}-${index}`} className="flex min-w-0 flex-col gap-1 text-sm">{children}</label>
    </li>
  );
}

export default async function ExtractionPage({ params }: PageProps<"/extractions/[id]">) {
  const ctx = await requireAuth();
  const { id } = await params;
  let ex;
  try {
    ex = await getExtraction(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const p = ex.proposals;
  const vid = ex.documentVersionId;
  const result = ex.result as { profileId: string; added: { riskDetails: number; rules: number; limits: number; requirements: number }; skipped: { kind: string; summary: string; reason: string }[] } | null;
  const write = can(ctx, "appetite.write") && ex.status === "READY";
  const labels = new Map([...ex.carrierProduct.product.attributeDefinitions.map((a) => [a.key, a.label] as const), ...(p?.attributes ?? []).map((a) => [a.key, a.label] as const)]);

  return (
    <>
      <Link href={`/carriers/${ex.carrierProduct.writingCompany.id}?tab=appetite`} className="text-sm hover:underline">← {ex.carrierProduct.writingCompany.displayName}</Link>
      <h1 className="text-xl font-semibold">AI draft: {ex.carrierProduct.product.name}</h1>
      <p className="-mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        From <Link href={`/documents/${ex.documentVersion.document.id}`} className="hover:underline">{ex.documentVersion.document.title} v{ex.documentVersion.versionNumber}</Link> · read by {ex.model} for {ex.createdBy.name} · {fmtDateTime(ex.createdAt)}
        {ex.costUsd !== null && <> · estimated cost ${Number(ex.costUsd).toFixed(2)}</>}
      </p>

      {ex.status === "FAILED" && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">The AI couldn&apos;t read this guide: {ex.error}</p>}

      {ex.status === "APPLIED" && result && (
        <Section title="Applied">
          <p className="text-sm">
            Added {result.added.rules} rules, {result.added.riskDetails} new risk details, {result.added.limits} limits and {result.added.requirements} requirements.{" "}
            <Link href={`/appetite/${result.profileId}`} className="font-medium text-blue-800 hover:underline dark:text-blue-300">Open the appetite draft</Link> to edit it and submit it for approval.
          </p>
          {result.skipped.length > 0 && (
            <>
              <h3 className="text-sm font-medium">Skipped ({result.skipped.length})</h3>
              <ul className="flex flex-col gap-1 text-sm">{result.skipped.map((s, i) => <li key={i}><Badge tone="warn">{s.kind}</Badge> {s.summary}: <span className="text-zinc-600 dark:text-zinc-400">{s.reason}</span></li>)}</ul>
              {can(ctx, "appetite.write") && (
                <ActionForm action={retrySkippedAction.bind(null, ex.id)} submitLabel="Retry skipped items" pendingLabel="Retrying…" variant="secondary" className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">Tries them again into the same draft (useful after a fix). No new AI read, no cost.</span>
                </ActionForm>
              )}
            </>
          )}
        </Section>
      )}

      {p && (
        <>
          <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            AI proposals from the guide. Quotes are as the AI read them: open the page to check anything that matters. Untick what&apos;s wrong. Rules go into a draft that still needs approval; limits and requirements are added to the product.
          </p>
          <Section title="What the guide covers">
            <p className="text-sm">{p.summary}</p>
            {p.states.length > 0 && <p className="text-xs text-zinc-600 dark:text-zinc-400">States: {p.states.join(", ")}</p>}
          </Section>

          <Proposals write={write} action={applyExtractionAction.bind(null, ex.id)}>
            <fieldset disabled={!write} className="flex flex-col gap-4">
              <Section title={`Risk details (${p.attributes.length})`}>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">The questions the rules ask about a risk (e.g. roof covering). Ones this product already has are reused.</p>
                {p.attributes.length === 0 ? <p className="text-sm">None.</p> : (
                  <ul>{p.attributes.map((a, i) => (
                    <Pick key={i} name="attributes" index={i}>
                      <span><strong>{a.label}</strong> <span className="text-xs text-zinc-600 dark:text-zinc-400">({a.key} · {label(a.dataType)}{a.unit ? ` · ${a.unit}` : ""})</span>{ex.existingKeys.includes(a.key) && <> <Badge>Already defined</Badge></>}</span>
                      {a.allowedValues && <span className="text-xs">Values: {a.allowedValues.join(" · ")}</span>}
                      <Evidence versionId={vid} item={a} />
                    </Pick>
                  ))}</ul>
                )}
              </Section>

              <Section title={`Rules (${p.rules.length})`}>
                {p.rules.length === 0 ? <p className="text-sm">None.</p> : (
                  <ul>{p.rules.map((r, i) => (
                    <Pick key={i} name="rules" index={i}>
                      <span className="flex flex-wrap items-center gap-2">
                        <OutcomeBadge outcome={r.outcome} />
                        <span>{r.attributeKey ? <>If <strong>{labels.get(r.attributeKey) ?? r.attributeKey}</strong> {OPS[r.operator ?? ""] ?? r.operator} {r.value ?? ""}</> : "Any risk"}{r.states.length > 0 && ` · ${r.states.join(", ")}`}{r.naics.length > 0 && ` · NAICS ${r.naics.join(", ")}`}</span>
                      </span>
                      <span>{r.summary}</span>
                      <Evidence versionId={vid} item={r} />
                    </Pick>
                  ))}</ul>
                )}
              </Section>

              <Section title={`Limits (${p.limits.length})`}>
                {p.limits.length === 0 ? <p className="text-sm">None.</p> : (
                  <ul>{p.limits.map((l, i) => (
                    <Pick key={i} name="limits" index={i}>
                      <span><strong>{l.coverage}</strong>: {l.minLimit != null ? `min $${l.minLimit.toLocaleString("en-US")}` : ""}{l.minLimit != null && l.maxLimit != null ? " · " : ""}{l.maxLimit != null ? `max $${l.maxLimit.toLocaleString("en-US")}` : ""}{l.minLimit == null && l.maxLimit == null ? "no amount stated" : ""}</span>
                      <Evidence versionId={vid} item={l} />
                    </Pick>
                  ))}</ul>
                )}
              </Section>

              <Section title={`Requirements (${p.requirements.length})`}>
                {p.requirements.length === 0 ? <p className="text-sm">None.</p> : (
                  <ul>{p.requirements.map((q, i) => (
                    <Pick key={i} name="requirements" index={i}>
                      <span><Badge>{q.type}</Badge> {q.description}</span>
                      <Evidence versionId={vid} item={q} />
                    </Pick>
                  ))}</ul>
                )}
              </Section>
            </fieldset>
          </Proposals>
        </>
      )}
    </>
  );
}

/** Inside a form only while it can still be applied; afterwards the list is read-only (no dead button). */
function Proposals({ write, action, children }: { write: boolean; action: Parameters<typeof ActionForm>[0]["action"]; children: React.ReactNode }) {
  if (!write) return <div className="flex flex-col gap-4">{children}</div>;
  return <ActionForm action={action} submitLabel="Create draft from selected" pendingLabel="Creating the draft…" className="flex flex-col gap-4">{children}</ActionForm>;
}
