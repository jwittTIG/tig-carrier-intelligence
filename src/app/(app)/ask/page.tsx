import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { aiStatus, GUIDE_DISCLAIMER, listAskableCarriers, listRecentQuestions } from "@/server/services/guides";
import { Section, fmtDateTime } from "@/components/ui";
import { AskForm, VerdictBadge } from "./parts";

export const metadata = { title: "Ask the guides" };

export default async function AskPage() {
  const ctx = await requireAuth();
  const [carriers, recent] = await Promise.all([listAskableCarriers(ctx), listRecentQuestions(ctx)]);
  const { mode } = aiStatus();

  return (
    <>
      <h1 className="text-xl font-semibold">Ask the guides</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Ask about one carrier in plain English. AI reads that carrier&apos;s appetite guides and underwriting guidelines (PDFs on its Documents tab) and answers with the pages it relied on, for about a cent a question. Questions about roofs, losses, wiring and other risk details are free in the Market Finder once a carrier&apos;s appetite is approved.
      </p>
      {mode === "off" && (
        <p role="note" className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          AI isn&apos;t set up yet. Add <code>ANTHROPIC_API_KEY</code> to <code>.env.local</code> and restart the app. Never paste the key in a chat or email.
        </p>
      )}
      {mode === "dev" && (
        <p role="note" className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Development reader (AI_DRIVER=dev): answers come from a simple text match, not AI. For testing only.
        </p>
      )}
      <AskForm carriers={carriers} aiReady={mode !== "off"} />
      <p role="note" className="text-xs text-zinc-600 dark:text-zinc-400">{GUIDE_DISCLAIMER}</p>

      <Section title="Recent questions">
        {recent.length === 0 ? (
          <p className="text-sm">No questions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {recent.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center gap-2">
                <VerdictBadge verdict={q.verdict} status={q.status} />
                <Link href={`/ask/${q.id}`} className="text-blue-800 hover:underline dark:text-blue-300">{q.question}</Link>
                <span className="text-xs text-zinc-600 dark:text-zinc-400">{q.organization.displayName} · {q.askedBy.name} · {fmtDateTime(q.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
