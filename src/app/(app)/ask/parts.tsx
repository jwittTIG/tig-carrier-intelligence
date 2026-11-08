import { ActionForm } from "@/components/action-form";
import { Badge, Field, inputClass } from "@/components/ui";
import { askAction } from "./actions";

export const VERDICT_TEXT: Record<string, string> = {
  YES: "Yes, per the guide",
  NO: "No, per the guide",
  REFER: "Refer to the underwriter",
  NOT_ADDRESSED: "Not addressed in the guide",
  UNCLEAR: "Unclear from the guide",
};

export function VerdictBadge({ verdict, status }: { verdict: string | null; status: string }) {
  if (status === "FAILED") return <Badge tone="bad">Couldn&apos;t answer</Badge>;
  if (status === "REFUSED") return <Badge tone="warn">AI declined</Badge>;
  const tone = verdict === "YES" ? "good" : verdict === "NO" ? "bad" : verdict === "REFER" || verdict === "UNCLEAR" ? "warn" : "neutral";
  return <Badge tone={tone}>{VERDICT_TEXT[verdict ?? "UNCLEAR"] ?? verdict}</Badge>;
}

export function AskForm({ carriers, defaultCarrierId, aiReady }: { carriers: { id: string; displayName: string }[]; defaultCarrierId?: string; aiReady: boolean }) {
  // No form until AI is set up: the page shows why instead (no buttons that do nothing).
  if (!aiReady) return null;
  return (
    <ActionForm action={askAction} submitLabel="Ask" pendingLabel="Reading the guides… (this can take a minute)" showOk={false} className="flex flex-col gap-3 rounded-2xl border border-transparent bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <Field label="Question" htmlFor="question" hint="Name the carrier in the question, or pick it below.">
        <textarea id="question" name="question" required minLength={3} maxLength={1000} rows={3} placeholder="Will Travelers write a home with a wood shake roof?" className={inputClass} />
      </Field>
      <Field label="Carrier" htmlFor="organizationId">
        <select id="organizationId" name="organizationId" defaultValue={defaultCarrierId ?? ""} className={inputClass}>
          <option value="">Find it in the question</option>
          {carriers.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
        </select>
      </Field>
    </ActionForm>
  );
}
