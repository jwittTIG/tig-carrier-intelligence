import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getImport, TARGETS } from "@/server/services/imports";
import { ActionForm } from "@/components/action-form";
import { Badge, Section, inputClass, label } from "@/components/ui";
import { commitImportAction, saveMappingAction } from "../actions";

export const metadata = { title: "Import preview" };

const TONE = { CREATE: "good", DUPLICATE: "neutral", POSSIBLE_DUPLICATE: "warn", ERROR: "bad" } as const;
const TEXT = { CREATE: "Will create", DUPLICATE: "Already exists: skip", POSSIBLE_DUPLICATE: "Possible duplicate", ERROR: "Error: skip" } as const;

export default async function ImportPage({ params }: PageProps<"/imports/[id]">) {
  const ctx = await requireAuth();
  if (!can(ctx, "import.run")) return <p role="alert">You don&apos;t have permission to import.</p>;
  const { id } = await params;
  let r;
  try {
    r = await getImport(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { job, headers, sample, preview, fields } = r;
  const map = job.map;
  const committed = job.status === "COMMITTED";
  const counts = preview?.reduce((acc, p) => ({ ...acc, [p.action]: (acc[p.action] ?? 0) + 1 }), {} as Record<string, number>) ?? {};
  const willCreate = (counts.CREATE ?? 0) + (map.createPossibleDuplicates ? counts.POSSIBLE_DUPLICATE ?? 0 : 0);

  return (
    <>
      <Link href="/imports" className="text-sm hover:underline">← Imports</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{job.sourceFilename}</h1>
        <Badge>{TARGETS[job.target].label}</Badge>
        <Badge tone={committed ? "good" : job.status === "FAILED" ? "bad" : "neutral"}>{label(job.status)}</Badge>
      </div>
      <p className="-mt-2 text-sm text-zinc-600 dark:text-zinc-400">{job.totalRows} rows · uploaded by {job.initiatedBy.name}</p>

      {committed ? (
        <Section title="Result">
          <p className="text-sm">{job.acceptedRows} rows imported; {job.rejectedRows} not imported.</p>
          {job.errorObjectKey && <a href={`/api/v1/imports/${job.id}/errors`} className="text-sm text-blue-800 hover:underline dark:text-blue-300">Download the rows that weren&apos;t imported (CSV)</a>}
          <p className="text-xs text-zinc-500">Each imported record shows this file and row as its source.</p>
        </Section>
      ) : (
        <>
          <Section title="1. Match columns">
            <ActionForm action={saveMappingAction.bind(null, id)} submitLabel="Update preview">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {fields.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1 text-sm">
                    {f.label}{f.required && " *"}
                    <select name={`col:${f.key}`} defaultValue={map.columns[f.key] ?? ""} className={inputClass}>
                      <option value="">(not in file)</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="createPossibleDuplicates" defaultChecked={map.createPossibleDuplicates} />
                Also create rows marked &ldquo;possible duplicate&rdquo; (exact duplicates are always skipped)
              </label>
            </ActionForm>
            <details>
              <summary className="cursor-pointer text-sm">First rows of the file</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="text-left text-xs">
                  <thead><tr>{headers.map((h) => <th key={h} scope="col" className="px-2 py-1">{h}</th>)}</tr></thead>
                  <tbody>{sample.map((row, i) => <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">{headers.map((h, j) => <td key={h} className="px-2 py-1">{row[j]}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </details>
          </Section>

          <Section title="2. Preview">
            <p className="text-sm">
              {Object.entries(TEXT).map(([k, t]) => <span key={k} className="mr-3"><Badge tone={TONE[k as keyof typeof TONE]}>{t}</Badge> {counts[k] ?? 0}</span>)}
            </p>
            {job.status !== "PREVIEWED" && <p className="text-sm text-amber-700">Check the column matches above and press &ldquo;Update preview&rdquo; before committing.</p>}
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase text-zinc-500 dark:bg-zinc-900"><tr><th scope="col" className="py-1 pr-2">Row</th><th scope="col" className="py-1 pr-2">Result</th><th scope="col" className="py-1 pr-2">Record</th><th scope="col" className="py-1">Why</th></tr></thead>
                <tbody>
                  {preview?.slice(0, 500).map((p) => (
                    <tr key={p.row} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                      <td className="py-1 pr-2">{p.row}</td>
                      <td className="py-1 pr-2"><Badge tone={TONE[p.action]}>{TEXT[p.action]}</Badge></td>
                      <td className="py-1 pr-2">{job.target === "ORGANIZATION" ? p.values.displayName : `${p.values.firstName} ${p.values.lastName}`}</td>
                      <td className="py-1">{p.messages.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview && preview.length > 500 && <p className="text-xs text-zinc-500">Showing the first 500 of {preview.length} rows.</p>}
            </div>
          </Section>

          {job.status === "PREVIEWED" && (
            <Section title="3. Import">
              <p className="text-sm">{willCreate} records will be created in one step. If anything fails, nothing is saved.</p>
              <ActionForm action={commitImportAction.bind(null, id)} submitLabel={`Import ${willCreate} rows`} confirm={`Create ${willCreate} records?`}>{null}</ActionForm>
            </Section>
          )}
        </>
      )}
    </>
  );
}
