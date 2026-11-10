import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getDocument } from "@/server/services/documents";
import { draftTargets, guideAppetite } from "@/server/services/extractions";
import { aiStatus } from "@/server/services/guides";
import { GuideAppetiteRow } from "../../extractions/guide-appetite";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, Section, fmtDateTime, inputClass, label } from "@/components/ui";
import { archiveDocumentAction, updateDocumentAction, uploadVersionAction } from "../../m4-actions";

const TYPES = ["APPETITE_GUIDE", "BULLETIN", "UNDERWRITING_GUIDELINES", "AGREEMENT", "COMMISSION_SCHEDULE", "APPLICATION", "OTHER"];

function kb(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export default async function DocumentPage({ params }: PageProps<"/documents/[id]">) {
  const ctx = await requireAuth();
  const { id } = await params;
  let doc;
  try {
    doc = await getDocument(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
  const write = can(ctx, "document.write");
  const latest = [...doc.versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const isGuide = ["APPETITE_GUIDE", "UNDERWRITING_GUIDELINES"].includes(doc.documentType) && doc.status === "ACTIVE" && doc.classification !== "RESTRICTED" && latest?.mimeType === "application/pdf";
  const canDraft = isGuide && aiStatus().mode !== "off" && can(ctx, "appetite.write");
  const [targets, states] = await Promise.all([
    canDraft ? draftTargets(ctx, doc.id) : Promise.resolve([]),
    isGuide && can(ctx, "appetite.read") ? guideAppetite(ctx, [{ documentId: doc.id, documentVersionId: latest.id }]) : Promise.resolve(null),
  ]);
  const state = states?.get(doc.id);
  return (
    <>
      <Link href="/documents" className="text-sm hover:underline">← Documents</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{doc.title}</h1>
        <Badge>{label(doc.documentType)}</Badge>
        <Badge tone={doc.classification === "RESTRICTED" ? "warn" : "neutral"}>{label(doc.classification)}</Badge>
        {doc.status === "ARCHIVED" && <Badge tone="bad">Archived</Badge>}
      </div>

      {doc.duplicates.length > 0 && (
        <p role="note" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-700 dark:bg-amber-950">
          The same file is also stored as:{" "}
          {doc.duplicates.map((d, i) => <span key={d.document.id}>{i > 0 && ", "}<Link href={`/documents/${d.document.id}`} className="underline">{d.document.title}</Link></span>)}
        </p>
      )}

      {(canDraft || (state && state.history.length > 0)) && (
        <Section title="Appetite from this guide (AI)">
          <GuideAppetiteRow
            guide={{ documentId: doc.id, documentVersionId: latest.id, title: doc.title, versionNumber: latest.versionNumber }}
            state={state}
            targets={targets.map((t) => ({ id: t.id, label: `${t.writingCompany.displayName}: ${t.product.name}` }))}
            canWrite={canDraft && can(ctx, "document.read")}
          />
        </Section>
      )}

      <Section title="Versions">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-600 dark:text-zinc-400">
            <tr><th scope="col" className="py-1 pr-3">Version</th><th scope="col" className="py-1 pr-3">Uploaded</th><th scope="col" className="py-1 pr-3">Type / size</th><th scope="col" className="py-1 pr-3">Cited by</th><th scope="col" className="py-1"><span className="sr-only">Download</span></th></tr>
          </thead>
          <tbody>
            {doc.versions.map((v) => (
              <tr key={v.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-1 pr-3">v{v.versionNumber}</td>
                <td className="py-1 pr-3">{fmtDateTime(v.uploadedAt)} · {v.uploadedBy.name}</td>
                <td className="py-1 pr-3">{v.mimeType.split("/").pop()} · {kb(v.sizeBytes)}</td>
                <td className="py-1 pr-3">{v.recordSources.length === 0 ? "—" : v.recordSources.map((s) => `${label(s.recordType)}${s.pageOrSection ? ` (${s.pageOrSection})` : ""}`).join(", ")}</td>
                <td className="py-1">
                  {/* A plain link: the route checks permission, then redirects to a 5-minute signed URL. */}
                  <a href={`/api/v1/document-versions/${v.id}/download`} className="text-blue-800 hover:underline dark:text-blue-300">Download</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {write && doc.status === "ACTIVE" && (
          <ActionForm action={uploadVersionAction.bind(null, doc.id)} submitLabel="Upload new version" className="flex flex-wrap items-end gap-3">
            <Field label="File" htmlFor="verFile"><input id="verFile" name="file" type="file" required className="text-sm" /></Field>
          </ActionForm>
        )}
      </Section>

      {write && (
        <Section title="Details">
          <ActionForm action={updateDocumentAction.bind(null, doc.id)} submitLabel="Save" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Title" htmlFor="dTitle"><input id="dTitle" name="title" defaultValue={doc.title} required className={inputClass} /></Field>
            <Field label="Type" htmlFor="dType">
              <select id="dType" name="documentType" defaultValue={doc.documentType} className={inputClass}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>
            </Field>
            <Field label="Who can see it" htmlFor="dClass">
              <select id="dClass" name="classification" defaultValue={doc.classification} className={inputClass}>
                <option value="GENERAL">General</option>
                <option value="INTERNAL">Internal</option>
                <option value="RESTRICTED">Restricted (financial)</option>
              </select>
            </Field>
          </ActionForm>
          <ActionForm action={archiveDocumentAction.bind(null, doc.id, doc.status === "ACTIVE")} submitLabel={doc.status === "ACTIVE" ? "Archive document" : "Restore document"} variant={doc.status === "ACTIVE" ? "danger" : "secondary"} confirm={doc.status === "ACTIVE" ? "Archive this document? Records that cite it keep their link." : undefined}>
            {null}
          </ActionForm>
        </Section>
      )}
    </>
  );
}
