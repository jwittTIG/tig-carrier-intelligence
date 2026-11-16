import { ActionForm } from "@/components/action-form";
import { Field, inputClass, label } from "@/components/ui";
import { uploadDocumentAction } from "../m4-actions";

const TYPES = ["APPETITE_GUIDE", "BULLETIN", "UNDERWRITING_GUIDELINES", "AGREEMENT", "COMMISSION_SCHEDULE", "APPLICATION", "OTHER"];

/** Upload a new document. With `organizationId`, it is filed under that carrier and the page stays put. */
export function UploadForm({ organizationId, returnTo, carriers }: { organizationId?: string; returnTo?: string; carriers?: { id: string; displayName: string }[] }) {
  return (
    <ActionForm action={uploadDocumentAction.bind(null, returnTo ?? null)} submitLabel="Upload" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Field label="Title (optional)" htmlFor="docTitle" hint="Leave blank to use the document's own title.">
        <input id="docTitle" name="title" maxLength={200} className={inputClass} />
      </Field>
      <Field label="Type" htmlFor="docType">
        <select id="docType" name="documentType" className={inputClass}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>
      </Field>
      <Field label="Who can see it" htmlFor="docClass" hint="Restricted: agreements and commission schedules">
        <select id="docClass" name="classification" defaultValue="INTERNAL" className={inputClass}>
          <option value="GENERAL">General</option>
          <option value="INTERNAL">Internal</option>
          <option value="RESTRICTED">Restricted (financial)</option>
        </select>
      </Field>
      {organizationId ? (
        <input type="hidden" name="organizationId" value={organizationId} />
      ) : (
        carriers && (
          <Field label="File under carrier (optional)" htmlFor="docOrg">
            <select id="docOrg" name="organizationId" className={inputClass}>
              <option value="">None</option>
              {carriers.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </select>
          </Field>
        )
      )}
      <Field label="File" htmlFor="docFile" hint="PDF, image, Word, Excel, CSV or text; up to 25 MB">
        <input id="docFile" name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" className="text-sm" />
      </Field>
    </ActionForm>
  );
}
