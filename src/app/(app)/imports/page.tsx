import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { listImports, MAX_ROWS, TARGETS } from "@/server/services/imports";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, Section, fmtDateTime, inputClass, label } from "@/components/ui";
import { uploadImportAction } from "./actions";

export const metadata = { title: "Import" };

export default async function ImportsPage() {
  const ctx = await requireAuth();
  if (!can(ctx, "import.run")) return <p role="alert">You don&apos;t have permission to import.</p>;
  const jobs = await listImports(ctx);
  return (
    <>
      <h1 className="text-xl font-semibold">Import from a spreadsheet</h1>
      <Section title="Upload a CSV">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Save the sheet as CSV (UTF-8) with a header row, up to {MAX_ROWS.toLocaleString()} rows. You&apos;ll match columns and preview every row before anything is saved.
          Existing records are never overwritten. Appetite, codes and commissions imports will follow once we&apos;ve seen TIG&apos;s current sheets.
        </p>
        <ActionForm action={uploadImportAction} submitLabel="Upload and preview" showOk={false} className="flex flex-wrap items-end gap-3">
          <Field label="What's in it" htmlFor="impTarget">
            <select id="impTarget" name="targetType" className={inputClass}>
              {Object.entries(TARGETS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="CSV file" htmlFor="impFile"><input id="impFile" name="file" type="file" accept=".csv" required className="text-sm" /></Field>
        </ActionForm>
      </Section>
      <Section title="Recent imports">
        {jobs.length === 0 ? <p className="text-sm text-zinc-500">None yet.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500"><tr><th scope="col" className="py-1 pr-3">File</th><th scope="col" className="py-1 pr-3">Contents</th><th scope="col" className="py-1 pr-3">Status</th><th scope="col" className="py-1 pr-3">Rows</th><th scope="col" className="py-1">By</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1 pr-3"><Link href={`/imports/${j.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{j.sourceFilename}</Link></td>
                  <td className="py-1 pr-3">{TARGETS[j.targetType as keyof typeof TARGETS]?.label ?? label(j.targetType)}</td>
                  <td className="py-1 pr-3"><Badge tone={j.status === "COMMITTED" ? "good" : j.status === "FAILED" ? "bad" : "neutral"}>{label(j.status)}</Badge></td>
                  <td className="py-1 pr-3">{j.status === "COMMITTED" ? `${j.acceptedRows} imported, ${j.rejectedRows} not` : `${j.totalRows} rows`}</td>
                  <td className="py-1">{j.initiatedBy.name} · {fmtDateTime(j.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
