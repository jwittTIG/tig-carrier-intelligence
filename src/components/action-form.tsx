"use client";

import { useActionState } from "react";
import type { ActionState } from "@/server/actions/run";

type Props = {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  /** Show the success message (off for forms that redirect). */
  showOk?: boolean;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
  /** Button text while the action runs (default "Saving…"). */
  pendingLabel?: string;
  /** Hidden extra words for screen readers when many buttons share a label (e.g. "rule 12"). */
  submitHint?: string;
};

const variants = {
  primary: "bg-blue-700 text-white hover:bg-blue-800",
  secondary: "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-300",
};

/** A form bound to a server action, with pending state and inline error/success messages. */
export function ActionForm({ action, children, submitLabel, className, showOk = true, variant = "primary", confirm, pendingLabel = "Saving…", submitHint }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className ?? "flex flex-col gap-3"}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${variants[variant]}`}>
          {pending ? pendingLabel : submitLabel}
          {submitHint && !pending && <span className="sr-only"> {submitHint}</span>}
        </button>
        {state?.error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{state.error}</p>}
        {showOk && state?.ok && !pending && <p role="status" className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>}
      </div>
    </form>
  );
}
