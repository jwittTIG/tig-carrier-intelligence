"use client";

import { createContext, startTransition, useActionState, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ActionState } from "@/server/actions/run";
import { Badge, buttonBase, buttonClass, inputClass, label } from "@/components/ui";

/** Lets parts of the form ask for the selection count to be refreshed after changing boxes in code. */
const Recount = createContext<() => void>(() => {});

/**
 * The AI draft review form (Josh, 2026-11-16: approval felt clunky). Tick what to keep, then one
 * bar at the bottom finishes it: create and approve (an admin's own work, with a typed reason as
 * D14 requires), create and submit for someone else to approve, or just create the draft.
 */
export function ReviewForm({ action, children, canApproveOwn, defaultEffective }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; children: React.ReactNode; canApproveOwn: boolean; defaultEffective: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const form = useRef<HTMLFormElement>(null);
  const [counts, setCounts] = useState<{ checked: number; total: number }>({ checked: 0, total: 0 });
  // Stable, and only updates when the numbers change (it is also called from effects).
  const recount = useCallback(() => {
    const boxes = form.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-pick]') ?? [];
    const next = { checked: [...boxes].filter((b) => b.checked).length, total: boxes.length };
    setCounts((c) => (c.checked === next.checked && c.total === next.total ? c : next));
  }, []);
  useEffect(recount, [recount]);
  const ids = { date: useId(), reason: useId() };

  return (
    <form
      ref={form}
      onChange={recount}
      // Not React's form action: that clears the form even when approval fails, undoing the ticks.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-4 pb-4"
    >
      <Recount.Provider value={recount}>{children}</Recount.Provider>
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-8px_20px_-12px_rgb(15_23_42/0.25)] backdrop-blur sm:mx-0 sm:rounded-2xl sm:border dark:border-zinc-700 dark:bg-zinc-900/95">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <p className="text-[13px] text-zinc-700 lg:mb-2 lg:mr-auto dark:text-zinc-200" aria-live="polite">
            <strong className="font-semibold">{counts.checked}</strong> of {counts.total} items selected
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.date} className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Effective from</label>
            <input id={ids.date} name="effectiveFrom" type="date" defaultValue={defaultEffective} className={`${inputClass} lg:w-40`} />
          </div>
          <div className="flex flex-col gap-1 lg:w-80">
            <label htmlFor={ids.reason} className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
              {canApproveOwn ? "Reason for approving (recorded)" : "Note for the reviewer (optional)"}
            </label>
            <input
              id={ids.reason}
              name="rationale"
              maxLength={2000}
              list={canApproveOwn ? `${ids.reason}-list` : undefined}
              placeholder={canApproveOwn ? "At least 10 characters" : ""}
              className={inputClass}
            />
            {canApproveOwn && (
              <datalist id={`${ids.reason}-list`}>
                <option value="Checked the AI draft page by page against the guide" />
                <option value="Reviewed the rules against the carrier's guide" />
                <option value="Confirmed with the carrier's underwriter" />
              </datalist>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="intent" value="draft" disabled={pending} className={`${buttonBase} ${buttonClass.secondary}`}>
              Create draft from selected
            </button>
            {canApproveOwn ? (
              <button type="submit" name="intent" value="approve" disabled={pending} className={`${buttonBase} ${buttonClass.primary}`}>
                {pending ? "Working…" : "Create and approve"}
              </button>
            ) : (
              <button type="submit" name="intent" value="submit" disabled={pending} className={`${buttonBase} ${buttonClass.primary}`}>
                {pending ? "Working…" : "Create and submit for approval"}
              </button>
            )}
          </div>
        </div>
        {state?.error && <p role="alert" className="mt-2 text-[13px] text-red-700 dark:text-red-400">{state.error}</p>}
        {state?.ok && !pending && <p role="status" className="mt-2 text-[13px] text-emerald-700 dark:text-emerald-400">{state.ok}</p>}
      </div>
    </form>
  );
}

export type ReviewRule = {
  index: number;
  outcome: string;
  condition: string;
  summary: string;
  page: number;
  quote: string;
  confidence: number;
  href: string;
};

const ORDER = ["PROHIBITED", "REFERRAL", "ACCEPTED", "PREFERRED", "UNKNOWN"];
const TONE: Record<string, "bad" | "warn" | "good" | "neutral"> = { PROHIBITED: "bad", REFERRAL: "warn", ACCEPTED: "good", PREFERRED: "good", UNKNOWN: "neutral" };
const UNSURE = 0.8;

/**
 * The AI's proposed rules, grouped by outcome, with a search, "only ones to check", and select
 * all/none per group. Every rule stays in the form; filters only hide rows from view.
 */
export function RulesReview({ rules }: { rules: ReviewRule[] }) {
  const [checked, setChecked] = useState<boolean[]>(() => rules.map(() => true));
  const [query, setQuery] = useState("");
  const [onlyUnsure, setOnlyUnsure] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const searchId = useId();
  const unsureCount = rules.filter((r) => r.confidence < UNSURE).length;

  const groups = useMemo(() => {
    const by = new Map<string, ReviewRule[]>();
    for (const r of rules) by.set(r.outcome, [...(by.get(r.outcome) ?? []), r]);
    return [...by.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  }, [rules]);
  const q = query.trim().toLowerCase();
  const visible = (r: ReviewRule) => (!onlyUnsure || r.confidence < UNSURE) && (!q || `${r.condition} ${r.summary} ${r.quote}`.toLowerCase().includes(q));
  const setMany = (indexes: number[], value: boolean) => setChecked((c) => c.map((v, i) => (indexes.includes(i) ? value : v)));
  // Boxes changed in code (select all/none) don't fire the form's change event: refresh the count.
  const recount = useContext(Recount);
  useEffect(() => { recount(); }, [checked, recount]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label htmlFor={searchId} className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Find a rule</label>
          <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. roof, pool, losses" className={inputClass} />
        </div>
        <label className="flex min-h-9 items-center gap-2 text-[13px] text-zinc-700 dark:text-zinc-200">
          <input type="checkbox" checked={onlyUnsure} onChange={(e) => setOnlyUnsure(e.target.checked)} />
          Only ones to check ({unsureCount})
        </label>
        <span className="flex min-h-9 items-center gap-2">
          <button type="button" onClick={() => setMany(rules.map((r) => r.index), true)} className={`${buttonBase} ${buttonClass.ghost}`}>Select all</button>
          <button type="button" onClick={() => setMany(rules.map((r) => r.index), false)} className={`${buttonBase} ${buttonClass.ghost}`}>Select none</button>
        </span>
      </div>

      {groups.map(([outcome, list]) => {
        const shown = list.filter(visible);
        const picked = list.filter((r) => checked[r.index]).length;
        const isClosed = closed[outcome] ?? false;
        return (
          <div key={outcome} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex flex-wrap items-center gap-2 bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => setClosed((c) => ({ ...c, [outcome]: !isClosed }))}
                aria-expanded={!isClosed}
                className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-100"
              >
                <span aria-hidden="true" className={`transition-transform duration-200 ${isClosed ? "" : "rotate-90"}`}>›</span>
                <Badge tone={TONE[outcome] ?? "neutral"}>{label(outcome)}</Badge>
                <span className="font-normal text-zinc-600 dark:text-zinc-400">{picked} of {list.length} selected</span>
              </button>
              <span className="ml-auto flex gap-1">
                <button type="button" onClick={() => setMany(list.map((r) => r.index), true)} className="rounded-md px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-200 dark:text-zinc-200 dark:hover:bg-zinc-700">All<span className="sr-only"> {label(outcome)} rules</span></button>
                <button type="button" onClick={() => setMany(list.map((r) => r.index), false)} className="rounded-md px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-200 dark:text-zinc-200 dark:hover:bg-zinc-700">None<span className="sr-only"> of the {label(outcome)} rules</span></button>
              </span>
            </div>
            {/* Every rule stays in the form (hidden rows still count); filters only hide them. */}
            <ul hidden={isClosed} className="divide-y divide-zinc-100 px-3 dark:divide-zinc-800">
              {list.map((r) => (
                <li key={r.index} hidden={!visible(r)} className="flex gap-3 py-2.5">
                  <input
                    type="checkbox"
                    name="rules"
                    value={r.index}
                    data-pick
                    id={`rules-${r.index}`}
                    checked={checked[r.index]}
                    onChange={(e) => setMany([r.index], e.target.checked)}
                    className="mt-1 shrink-0"
                  />
                  <label htmlFor={`rules-${r.index}`} className="flex min-w-0 flex-col gap-1 text-[13px]">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{r.condition}</span>
                    <span className="text-zinc-700 dark:text-zinc-300">{r.summary}</span>
                    <span className="flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="italic">“{r.quote}”</span>
                      <span className="flex flex-wrap items-center gap-2">
                        <a href={r.href} target="_blank" rel="noopener noreferrer" className="text-blue-700 dark:text-blue-300">
                          Page {r.page} <span aria-hidden="true">↗</span><span className="sr-only"> (opens the guide in a new tab)</span>
                        </a>
                        {r.confidence < UNSURE ? <Badge tone="warn">Check this ({Math.round(r.confidence * 100)}% sure; may be simplified)</Badge> : <span>confidence {Math.round(r.confidence * 100)}%</span>}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="py-2.5 text-[13px] text-zinc-600 dark:text-zinc-400">No rules here match the filter.</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
