import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { aiStatus, getQuestion, GUIDE_DISCLAIMER, listAskableCarriers } from "@/server/services/guides";
import { Section, fmtDate, fmtDateTime } from "@/components/ui";
import { AskForm, CheckFullGuide, VerdictBadge } from "../parts";

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

  return (
    <>
      <Link href="/ask" className="back-link">← Ask the guides</Link>
      <h1 className="page-title">{q.question}</h1>
      <p className="-mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        <Link href={`/carriers/${q.organization.id}`} className="hover:underline">{q.organization.displayName}</Link> · asked by {q.askedBy.name} · {fmtDateTime(q.createdAt)}
      </p>

      <Section title="Answer">
        <div className="flex flex-wrap items-center gap-2"><VerdictBadge verdict={q.verdict} status={q.status} /></div>
        {q.status === "FAILED" && <p className="text-sm text-red-700 dark:text-red-400">The AI request failed, so there is no answer. Try again in a minute. ({q.error})</p>}
        {q.answerText && <p className="whitespace-pre-wrap text-sm">{q.answerText}</p>}
        {pagesMode && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Read from the guides&apos; page text ({allPages ? "every page" : `the best-matching pages: ${sentText}`}) by {q.model}.
            {!allPages && " If the answer seems incomplete, check the full guide."}
          </p>
        )}
        <p role="note" className="rounded-xl border border-zinc-300 bg-zinc-100 p-2 text-xs dark:border-zinc-600 dark:bg-zinc-800">{GUIDE_DISCLAIMER}</p>
        {pagesMode && aiOn && <CheckFullGuide question={q.question} organizationId={q.organization.id} emphasize={q.verdict === "NOT_ADDRESSED" || q.verdict === "UNCLEAR" || q.status !== "ANSWERED"} />}
      </Section>

      <Section title={`What it relied on (${q.citations.length})`}>
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
