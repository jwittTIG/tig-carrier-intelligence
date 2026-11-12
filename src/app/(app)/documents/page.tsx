import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { listCarrierOptions } from "@/server/services/carriers";
import { listDocuments } from "@/server/services/documents";
import { Badge, Section, fmtDateTime, inputClass, label } from "@/components/ui";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Documents" };

const TYPES = ["APPETITE_GUIDE", "BULLETIN", "UNDERWRITING_GUIDELINES", "AGREEMENT", "COMMISSION_SCHEDULE", "APPLICATION", "OTHER"];

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v)) as Record<string, string>;
  const [docs, carriers] = await Promise.all([listDocuments(ctx, params), listCarrierOptions(ctx)]);
  return (
    <>
      <h1 className="page-title">Documents</h1>
      {can(ctx, "document.write") && (
        <Section title="Upload a document">
          <UploadForm carriers={carriers} />
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Files are checked by content, scanned, and stored privately. Downloads use links that expire after 5 minutes.</p>
        </Section>
      )}
      <form method="get" role="search" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">Title<input name="q" defaultValue={params.q} className={inputClass} /></label>
        <label className="flex flex-col gap-1">
          Type
          <select name="documentType" defaultValue={params.documentType ?? ""} className={inputClass}>
            <option value="">Any</option>
            {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Carrier
          <select name="organizationId" defaultValue={params.organizationId ?? ""} className={inputClass}>
            <option value="">Any</option>
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" name="includeArchived" defaultChecked={params.includeArchived === "on"} />Include archived</label>
        <button className="inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium bg-blue-700 text-white shadow-xs hover:bg-blue-800">Filter</button>
        <Link href="/documents" className="px-2 py-1.5 hover:underline">Clear</Link>
      </form>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-600 dark:text-zinc-400 dark:border-zinc-700">
            <tr><th scope="col" className="px-3 py-2">Title</th><th scope="col" className="px-3 py-2">Type</th><th scope="col" className="px-3 py-2">Visibility</th><th scope="col" className="px-3 py-2">Latest</th><th scope="col" className="px-3 py-2">Owner</th></tr>
          </thead>
          <tbody>
            {docs.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-600 dark:text-zinc-400">No documents.</td></tr>}
            {docs.map((d) => (
              <tr key={d.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">
                  <Link href={`/documents/${d.id}`} className="font-medium text-zinc-900 hover:text-blue-700 dark:text-zinc-100 dark:hover:text-blue-300">{d.title}</Link>
                  {d.status === "ARCHIVED" && <Badge>Archived</Badge>}
                </td>
                <td className="px-3 py-2">{label(d.documentType)}</td>
                <td className="px-3 py-2"><Badge tone={d.classification === "RESTRICTED" ? "warn" : "neutral"}>{label(d.classification)}</Badge></td>
                <td className="px-3 py-2">{d.latest ? `v${d.latest.versionNumber} · ${fmtDateTime(d.latest.uploadedAt)}` : "—"}</td>
                <td className="px-3 py-2">{d.owner?.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
