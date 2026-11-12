"use client";

import { useActionState } from "react";
import type { ActionState } from "@/server/actions/run";
import { buttonBase, buttonClass } from "./ui";

type Props = {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  /** Show the success message (off for forms that redirect). */
  showOk?: boolean;
  variant?: "primary" | "secondary" | "danger" | "accent";
  confirm?: string;
  /** Button text while the action runs (default "Saving…"). */
  pendingLabel?: string;
  /** Hidden extra words for screen readers when many buttons share a label (e.g. "rule 12"). */
  submitHint?: string;
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
        <button type="submit" disabled={pending} className={`${buttonBase} ${buttonClass[variant]}`}>
          {pending ? pendingLabel : submitLabel}
          {submitHint && !pending && <span className="sr-only"> {submitHint}</span>}
        </button>
        {state?.error && <p role="alert" className="text-[13px] text-red-700 dark:text-red-400">{state.error}</p>}
        {showOk && state?.ok && !pending && <p role="status" className="text-[13px] text-emerald-700 dark:text-emerald-400">{state.ok}</p>}
      </div>
    </form>
  );
}
