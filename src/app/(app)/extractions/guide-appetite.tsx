import Link from "next/link";
import type { GuideAppetite } from "@/server/services/extractions";
import { Badge, fmtDateTime, label } from "@/components/ui";
import { DraftFromGuide, ReadGuideFor } from "./draft-from-guide";

type Guide = { documentId: string; documentVersionId: string; title: string; versionNumber: number };

const linkClass = "text-blue-800 hover:underline dark:text-blue-300";

/**
 * Where one guide's appetite stands (N24): drafted once, then each new version replaces it.
 * The draft form shows only for a guide that has never been read.
 */
export function GuideAppetiteRow({ guide, state, targets, canWrite, showTitle }: { guide: Guide; state: GuideAppetite | undefined; targets: { id: string; label: string }[]; canWrite: boolean; showTitle?: boolean }) {
  const cur = state?.current ?? null;
  const earlier = state?.earlier ?? null;
  const older = (state?.history ?? []).filter((h) => h.id !== cur?.id);
  return (
    <div className="flex flex-col gap-1">
      {showTitle && <Link href={`/documents/${guide.documentId}`} className={`text-sm font-medium ${linkClass}`}>{guide.title} v{guide.versionNumber}</Link>}

      {cur && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span>{cur.carrierProduct.product.name}:</span>
          {cur.status === "RUNNING" && !cur.stalled && (
            <>
              <Badge tone="neutral">AI is reading v{guide.versionNumber}…</Badge>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">started {fmtDateTime(cur.createdAt)}; refresh in a few minutes</span>
            </>
          )}
          {cur.status === "READY" && (
            <>
              <Badge tone="warn">Ready for review</Badge>
              <Link href={`/extractions/${cur.id}`} className={linkClass}>Review the AI draft</Link>
            </>
          )}
          {cur.status === "APPLIED" && (
            <>
              <Badge tone="good">Drafted from v{guide.versionNumber}</Badge>
              {state?.profile && <Link href={`/appetite/${state.profile.id}`} className={linkClass}>Appetite v{state.profile.version} ({label(state.profile.status)})</Link>}
              <Link href={`/extractions/${cur.id}`} className="text-xs text-zinc-600 hover:underline dark:text-zinc-400">what was added</Link>
            </>
          )}
          {(cur.status === "FAILED" || cur.stalled) && (
            <>
              <Badge tone="bad">Couldn&apos;t read v{guide.versionNumber}</Badge>
              <Link href={`/extractions/${cur.id}`} className="text-xs text-zinc-600 hover:underline dark:text-zinc-400">details</Link>
            </>
          )}
        </p>
      )}
      {cur && (cur.status === "FAILED" || cur.stalled) && canWrite && <ReadGuideFor documentVersionId={guide.documentVersionId} carrierProductId={cur.carrierProductId} label="Read it again" />}

      {!cur && earlier && (
        <>
          <p className="text-sm">
            {earlier.carrierProduct.product.name}: drafted from v{earlier.documentVersion.versionNumber}. Version {guide.versionNumber} hasn&apos;t been read yet.
          </p>
          {canWrite && <ReadGuideFor documentVersionId={guide.documentVersionId} carrierProductId={earlier.carrierProductId} label={`Update appetite from v${guide.versionNumber}`} />}
        </>
      )}

      {!cur && !earlier && canWrite && <DraftFromGuide documentVersionId={guide.documentVersionId} targets={targets} compact />}
      {!cur && !earlier && !canWrite && <p className="text-sm text-zinc-600 dark:text-zinc-400">Not drafted from yet.</p>}

      {older.length > 0 && (
        <details className="text-xs text-zinc-600 dark:text-zinc-400">
          <summary className="cursor-pointer">Earlier AI reads ({older.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {older.map((h) => (
              <li key={h.id}>
                <Link href={`/extractions/${h.id}`} className="hover:underline">v{h.documentVersion.versionNumber} for {h.carrierProduct.product.name}, {fmtDateTime(h.createdAt)}</Link> · {h.status === "READY" ? "not applied" : label(h.status)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
