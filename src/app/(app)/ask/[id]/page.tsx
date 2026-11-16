import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { aiStatus, getQuestion, GUIDE_DISCLAIMER, listAskableCarriers } from "@/server/services/guides";
import { Section, fmtDate, fmtDateTime } from "@/components/ui";
import { AskForm, CheckFullGuide, VERDICT_TEXT } from "../parts";

/** The answer panel's colors by verdict (Josh, 2026-11-16: make the answer prominent). */
const LOOK: Record<string, { panel: string; bar: string; verdict: string }> = {
  YES: { panel: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30", bar: "bg-emerald-500", verdict: "text-emerald-800 dark:text-emerald-300" },
  NO: { panel: "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30", bar: "bg-red-500", verdict: "text-red-800 dark:text-red-300" },
  REFER: { panel: "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30", bar: "bg-amber-500", verdict: "text-amber-900 dark:text-amber-300" },
  OTHER: { panel: "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50", bar: "bg-zinc-400", verdict: "text-zinc-800 dark:text-zinc-100" },
};

export const metadata = { title: "Answer" };

export default async function AnswerPage({ params }: PageProps<"/ask/[id]">) {
  const ctx = await requireAuth();
  const { id } = await params;
  let q;
  try {
    q = await getQuestion(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const carriers = await listAskableCarriers(ctx);
  const pages = (c: { startPage: number; endPage: number }) => (c.endPage > c.startPage ? `pages ${c.startPage}–${c.endPage}` : `page ${c.startPage}`);
  const sent = (q.pagesSent ?? null) as { documentVersionId: string; pages: number[]; totalPages: number }[] | null;
  const pagesMode = q.mode === "PAGES";
  const allPages = !!sent && sent.every((s) => s.pages.length === s.totalPages);
  const sentText = sent ? sent.map((s) => `${s.pages.length} of ${s.totalPages}`).join(" + ") : "";
  const aiOn = aiStatus().mode !== "off";
  const look = q.status === "ANSWERED" ? (LOOK[q.verdict ?? ""] ?? LOOK.OTHER) : q.status === "FAILED" ? LOOK.NO : LOOK.OTHER;
  const verdictText = q.status === "FAILED" ? "Couldn't answer" : q.status === "REFUSED" ? "AI declined" : (VERDICT_TEXT[q.verdict ?? "UNCLEAR"] ?? q.verdict);

  return (
    <>
      <Link href="/ask" className="back-link">← Ask the guides</Link>
      {/* The question, smaller; the answer below is the main thing on the page. */}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Question</p>
        <h1 className="text-xl font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-100">{q.question}</h1>
        <p className="text-[13px] text-zinc-600 dark:text-zinc-400">
          <Link href={`/carriers/${q.organization.id}`} className="hover:underline">{q.organization.displayName}</Link> · asked by {q.askedBy.name} · {fmtDateTime(q.createdAt)}
        </p>
      </div>

      <section aria-labelledby="answer-heading" className={`relative overflow-hidden rounded-2xl border p-6 pl-8 shadow-xs ${look.panel}`}>
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${look.bar}`} />
        <h2 id="answer-heading" className="text-xs font-semibold tracking-wide text-zinc-600 dark:text-zinc-400">Answer</h2>
        <p className={`mt-1 text-[26px] font-semibold leading-tight tracking-tight ${look.verdict}`}>{verdictText}</p>
        {q.status === "FAILED" && <p className="mt-3 max-w-3xl text-base leading-7 text-zinc-900 dark:text-zinc-100">The AI request failed, so there is no answer. Try again in a minute. ({q.error})</p>}
        {q.answerText && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-base leading-7 text-zinc-900 dark:text-zinc-100">{q.answerText}</p>}
        {q.citations.length > 0 && <p className="mt-3 text-[13px] text-zinc-700 dark:text-zinc-300"><a href="#relied-on" className="font-medium">Based on {q.citations.length} {q.citations.length === 1 ? "passage" : "passages"} from the guide</a> ↓</p>}
      </section>

      <div className="-mt-2 flex flex-col gap-2">
        {pagesMode && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Read from the guides&apos; page text ({allPages ? "every page" : `the best-matching pages: ${sentText}`}) by {q.model}.
            {!allPages && " If the answer seems incomplete, check the full guide."}
          </p>
        )}
        <p role="note" className="text-xs text-zinc-600 dark:text-zinc-400">{GUIDE_DISCLAIMER}</p>
        {pagesMode && aiOn && <CheckFullGuide question={q.question} organizationId={q.organization.id} emphasize={q.verdict === "NOT_ADDRESSED" || q.verdict === "UNCLEAR" || q.status !== "ANSWERED"} />}
      </div>

      <Section id="relied-on" title={`What it relied on (${q.citations.length})`}>
        {q.citations.length === 0 ? (
          <p className="text-sm">{q.status === "ANSWERED" ? "No passages were cited. Treat this answer with extra care and check the guide." : "Nothing."}</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {q.citations.map((c, i) => (
              <li key={i} className="flex flex-col gap-1 border-l-4 border-blue-300 pl-3 dark:border-blue-700">
                <blockquote className="italic">“{c.quote}”</blockquote>
                <a href={`/api/v1/document-versions/${c.documentVersionId}/download?view=1#page=${c.startPage}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-800 hover:underline dark:text-blue-300">
                  {c.title} v{c.versionNumber}, {pages(c)} <span aria-hidden="true">↗</span><span className="sr-only"> (opens the PDF in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Guides read">
        <ul className="flex flex-col gap-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
          {q.guides.map((g) => (
            <li key={g.id}><Link href={`/documents/${g.document.id}`} className="hover:underline">{g.document.title} v{g.versionNumber}</Link> <span className="text-xs text-zinc-600 dark:text-zinc-400">uploaded {fmtDate(g.uploadedAt)}</span></li>
          ))}
        </ul>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {q.model} · {pagesMode ? "page text" : "whole PDF"} · {q.promptVersion}
          {q.costUsd !== null && <> · estimated cost ${Number(q.costUsd).toFixed(2)}</>}
        </p>
      </Section>

      <h2 className="text-base font-semibold">Ask another</h2>
      <AskForm carriers={carriers} defaultCarrierId={q.organization.id} aiReady={aiOn} />
    </>
  );
}
