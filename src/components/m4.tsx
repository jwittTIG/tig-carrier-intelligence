import Link from "next/link";
import type { AuthContext } from "@/server/auth/context";
import { can } from "@/server/auth/context";
import { decideAction, addSourceAction } from "@/app/(app)/m4-actions";
import { ActionForm } from "./action-form";
import { Badge, Field, fmtDateTime, inputClass, label } from "./ui";

/** Shared pieces for appetite, commission and document screens. */

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "good" : status === "PENDING" ? "warn" : status === "RETIRED" ? "neutral" : "neutral";
  return <Badge tone={tone}>{status === "PENDING" ? "Waiting for approval" : label(status)}</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const tone = outcome === "PREFERRED" || outcome === "ACCEPTED" ? "good" : outcome === "REFERRAL" ? "warn" : outcome === "PROHIBITED" ? "bad" : "neutral";
  return <Badge tone={tone}>{label(outcome)}</Badge>;
}

type Pending = { id: string; proposedById: string; createdAt: Date; rationale: string | null; proposedBy: { name: string } };

/**
 * Approve/reject controls for a pending change request (DECISIONS D14). The submitter sees
 * that it's waiting; an admin who submitted it can approve with a reason.
 */
export function DecisionPanel({ ctx, cr, permission, returnTo }: { ctx: AuthContext; cr: Pending; permission: "appetite.approve" | "commission.approve"; returnTo: string }) {
  const own = cr.proposedById === ctx.userId;
  const allowed = can(ctx, "change_request.review") && can(ctx, permission) && (!own || ctx.roles.includes("ADMIN"));
  return (
    <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
      <p>
        Submitted by <strong>{cr.proposedBy.name}</strong> on {fmtDateTime(cr.createdAt)}.{cr.rationale && <> Note: {cr.rationale}</>}
      </p>
      {own && !allowed && <p>Someone else needs to review it.</p>}
      {allowed && (
        <div className="flex flex-wrap gap-4">
          <ActionForm action={decideAction.bind(null, cr.id, "APPROVE", returnTo)} submitLabel="Approve" className="flex flex-wrap items-end gap-2">
            {own && (
              <Field label="Reason for approving your own submission" htmlFor={`ra-${cr.id}`}>
                <input id={`ra-${cr.id}`} name="rationale" required minLength={10} className={`${inputClass} min-w-64`} />
              </Field>
            )}
          </ActionForm>
          <ActionForm action={decideAction.bind(null, cr.id, "REJECT", returnTo)} submitLabel="Reject" variant="danger" className="flex flex-wrap items-end gap-2">
            <Field label="Why?" htmlFor={`rr-${cr.id}`}><input id={`rr-${cr.id}`} name="rationale" required className={`${inputClass} min-w-64`} /></Field>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

type Source = {
  id: string;
  sourceKind: string;
  pageOrSection: string | null;
  sourceNote: string | null;
  createdAt: Date;
  createdBy: { name: string };
  documentVersion: { id: string; versionNumber: number; document: { id: string; title: string } } | null;
  importJob: { sourceFilename: string } | null;
};

export function SourcesList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return <p className="text-sm text-zinc-500">No sources recorded.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {sources.map((s) => (
        <li key={s.id}>
          <Badge>{s.sourceKind === "USER_ENTERED" ? "Staff note" : label(s.sourceKind)}</Badge>{" "}
          {s.documentVersion && (
            <Link href={`/documents/${s.documentVersion.document.id}`} className="text-blue-800 hover:underline dark:text-blue-300">
              {s.documentVersion.document.title} v{s.documentVersion.versionNumber}
            </Link>
          )}
          {s.pageOrSection && <span> · {s.pageOrSection}</span>}
          {s.sourceNote && <span> · {s.sourceNote}</span>}
          {s.importJob && <span> · import {s.importJob.sourceFilename}</span>}
          <span className="text-xs text-zinc-500"> · {s.createdBy.name}, {fmtDateTime(s.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function AddSourceForm({ returnTo, recordType, recordId, versions }: { returnTo: string; recordType: string; recordId: string; versions: { id: string; versionNumber: number; document: { title: string } }[] }) {
  return (
    <ActionForm action={addSourceAction.bind(null, returnTo, recordType, recordId)} submitLabel="Add source" className="grid grid-cols-1 gap-2 sm:grid-cols-4">
      <Field label="Kind" htmlFor={`sk-${recordId}`}>
        <select id={`sk-${recordId}`} name="sourceKind" className={inputClass}>
          <option value="DOCUMENT">Document</option>
          <option value="USER_ENTERED">Staff note</option>
        </select>
      </Field>
      <Field label="Document" htmlFor={`sd-${recordId}`} hint="Upload it on Documents first">
        <select id={`sd-${recordId}`} name="documentVersionId" className={inputClass}>
          <option value="">—</option>
          {versions.map((v) => <option key={v.id} value={v.id}>{v.document.title} v{v.versionNumber}</option>)}
        </select>
      </Field>
      <Field label="Page or section" htmlFor={`sp-${recordId}`}><input id={`sp-${recordId}`} name="pageOrSection" maxLength={120} className={inputClass} /></Field>
      <Field label="Note" htmlFor={`sn-${recordId}`} hint="Required for a staff note, e.g. call with UW on 2026-10-01"><input id={`sn-${recordId}`} name="sourceNote" maxLength={1000} className={inputClass} /></Field>
    </ActionForm>
  );
}
