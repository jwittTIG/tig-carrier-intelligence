import { ActionForm } from "@/components/action-form";
import { Field, inputClass } from "@/components/ui";
import { startExtractionAction } from "./actions";

/** "Draft appetite from this guide": pick the product the guide covers; AI reads it once. */
export function DraftFromGuide({ documentVersionId, targets, compact }: { documentVersionId: string; targets: { id: string; label: string }[]; compact?: boolean }) {
  if (!targets.length) {
    return <p className="text-xs text-zinc-600 dark:text-zinc-400">To draft appetite from this guide, add the product it covers on the carrier&apos;s Writing companies &amp; channels tab first.</p>;
  }
  return (
    <ActionForm action={startExtractionAction} submitLabel="Draft appetite from this guide" pendingLabel="AI is reading the guide… (a few minutes)" showOk={false} className={compact ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-2"}>
      <input type="hidden" name="documentVersionId" value={documentVersionId} />
      <Field label="Product it covers" htmlFor={`cp-${documentVersionId}`}>
        <select id={`cp-${documentVersionId}`} name="carrierProductId" required className={inputClass}>
          {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </Field>
      {!compact && <p className="text-xs text-zinc-600 dark:text-zinc-400">AI reads the guide once (about $1.50–3 for a long guide) and proposes rules, limits and requirements with the page each came from. Nothing is used until you review it, and rules still need approval.</p>}
    </ActionForm>
  );
}
