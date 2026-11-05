import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { dataQuality, listQueue } from "@/server/services/approvals";
import { DecisionPanel } from "@/components/m4";
import { Badge, Section, fmtDate, fmtDateTime, label } from "@/components/ui";

export const metadata = { title: "Approvals & data quality" };

export default async function ApprovalsPage() {
  const ctx = await requireAuth();
  if (!can(ctx, "change_request.review")) return <p role="alert">You don&apos;t have permission to review changes.</p>;
  const [queue, quality] = await Promise.all([listQueue(ctx), dataQuality(ctx)]);
  return (
    <>
      <h1 className="text-xl font-semibold">Approvals &amp; data quality</h1>

      <Section title={`Waiting for approval (${queue.pending.length})`}>
        <p className="text-xs text-zinc-500">You can&apos;t approve your own submissions. An admin can, with a written reason (DECISIONS D14).</p>
        {queue.pending.length === 0 && <p className="text-sm text-zinc-500">Nothing is waiting.</p>}
        <ul className="flex flex-col gap-3">
          {queue.pending.map((cr) => (
            <li key={cr.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {cr.link ? <Link href={cr.link.href} className="font-medium text-blue-800 hover:underline dark:text-blue-300">{cr.link.label}</Link> : <span>{label(cr.recordType)}</span>}
                {cr.isOwn && <Badge>Your submission</Badge>}
                <ProposedSummary patch={cr.proposedPatch} />
              </div>
              {cr.canDecide && (
                <DecisionPanel ctx={ctx} cr={cr} permission={cr.recordType === "APPETITE_PROFILE" ? "appetite.approve" : "commission.approve"} returnTo="/approvals" />
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Due for review">
        {quality.staleAppetite.length === 0 ? <p className="text-sm text-zinc-500">No approved appetite profiles are past their review date.</p> : (
          <ul className="text-sm">
            {quality.staleAppetite.map((p) => (
              <li key={p.id}>
                <Link href={`/appetite/${p.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{p.carrierProduct.writingCompany.displayName} · {p.carrierProduct.product.name} v{p.version}</Link>
                <span className="text-zinc-500"> · review was due {fmtDate(p.nextReviewAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">
          <Link href="/contacts?freshness=stale" className="text-blue-800 hover:underline dark:text-blue-300">{quality.staleContacts} contacts</Link> are stale or were never confirmed ({quality.contactDays}-day review cycle).
        </p>
      </Section>

      <Section title="Possible duplicate carriers">
        {quality.duplicates.length === 0 ? <p className="text-sm text-zinc-500">No similar names found.</p> : (
          <ul className="text-sm">
            {quality.duplicates.map((d) => (
              <li key={`${d.a_id}-${d.b_id}`}>
                <Link href={`/carriers/${d.a_id}`} className="hover:underline">{d.a_name}</Link> and <Link href={`/carriers/${d.b_id}`} className="hover:underline">{d.b_name}</Link>
                <span className="text-zinc-500"> · {Math.round(d.score * 100)}% similar</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">Merging duplicates isn&apos;t built yet. Archive the extra record and move its details by hand.</p>
      </Section>

      <Section title="Recent decisions">
        {queue.recent.length === 0 ? <p className="text-sm text-zinc-500">None yet.</p> : (
          <ul className="text-sm">
            {queue.recent.map((cr) => (
              <li key={cr.id}>
                {label(cr.recordType)} · <Badge tone={cr.status === "APPROVED" ? "good" : cr.status === "REJECTED" ? "bad" : "neutral"}>{label(cr.status)}</Badge>
                {" "}submitted by {cr.proposedBy.name}{cr.reviewedBy && `, decided by ${cr.reviewedBy.name}`} {cr.reviewedAt && fmtDateTime(cr.reviewedAt)}
                {cr.rationale && <span className="text-zinc-500"> · {cr.rationale}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function ProposedSummary({ patch }: { patch: unknown }) {
  const p = (patch ?? {}) as { rate?: string; replaces?: { rate?: string; version?: number; endsOn?: string } | null; version?: number };
  const parts: string[] = [];
  if (p.rate) parts.push(`rate ${p.rate}`);
  if (p.replaces?.rate) parts.push(`replaces ${p.replaces.rate} (ends ${String(p.replaces.endsOn).slice(0, 10)})`);
  if (p.replaces?.version) parts.push(`replaces v${p.replaces.version}`);
  return parts.length ? <span className="text-zinc-600 dark:text-zinc-400">· {parts.join(" · ")}</span> : null;
}
