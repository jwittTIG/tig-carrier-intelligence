import { inputClass, label } from "@/components/ui";

/** Shared pieces for the Market Finder and the comparison (DECISIONS D21–D22). */

export function firstValues(sp: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

type Attribute = { key: string; label: string; dataType: string; unit: string | null; allowedValues?: string[] | null };

const PLACEHOLDER: Record<string, string> = { MONEY: "5,000,000", NUMBER: "12.5", INTEGER: "25", DATE: "YYYY-MM-DD", BOOLEAN: "yes or no" };

export function RiskAttributeInputs({ attributes, values, asked, needsInfo = false }: { attributes: Attribute[]; values: Record<string, string | undefined>; asked: boolean; needsInfo?: boolean }) {
  if (!asked) return null;
  if (!attributes.length) {
    return <p className="text-xs text-zinc-600 dark:text-zinc-400">No risk details (revenue, TIV…) are defined for this product. They are added on an appetite draft.</p>;
  }
  const filled = attributes.filter((a) => values[`a_${a.key}`]).length;
  // Folded away unless something is entered or the results need more details.
  return (
    <details open={filled > 0 || needsInfo} className="group rounded-xl border border-zinc-200 bg-zinc-50/60 dark:border-zinc-700 dark:bg-zinc-800/30">
      <summary className="flex list-none items-center justify-between gap-2 px-4 py-2.5 text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
        <span>Risk details <span className="font-normal text-zinc-600 dark:text-zinc-400">(optional; not saved) · {filled ? `${filled} of ${attributes.length} entered` : `${attributes.length} available`}</span></span>
        <span aria-hidden="true" className="text-zinc-500 transition-transform duration-200 group-open:rotate-180">▾</span>
      </summary>
    <fieldset className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-4 dark:border-zinc-700">
      <legend className="sr-only">Risk details</legend>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
        {attributes.map((a) => (
          <label key={a.key} className="flex flex-col justify-end gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200">
            <span className="line-clamp-2" title={a.label}>{a.label}{a.unit ? ` (${a.unit})` : ""}</span>
            {a.allowedValues?.length ? (
              <select name={`a_${a.key}`} defaultValue={values[`a_${a.key}`] ?? ""} className={inputClass}>
                <option value="">Not known</option>
                {a.allowedValues.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : a.dataType === "BOOLEAN" ? (
              <select name={`a_${a.key}`} defaultValue={values[`a_${a.key}`] ?? ""} className={inputClass}>
                <option value="">Not known</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            ) : (
              <input
                name={`a_${a.key}`}
                defaultValue={values[`a_${a.key}`]}
                type={a.dataType === "DATE" ? "date" : "text"}
                inputMode={["MONEY", "NUMBER", "INTEGER"].includes(a.dataType) ? "decimal" : undefined}
                placeholder={PLACEHOLDER[a.dataType]}
                className={inputClass}
              />
            )}
          </label>
        ))}
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Enter only what describes the risk. No client names are needed.</p>
    </fieldset>
    </details>
  );
}

const STATE_TEXT: Record<string, string> = { MET: "met", NOT_MET: "not met", MISSING: "not entered", CANNOT_EVALUATE: "can't be checked" };
const STATE_CLASS: Record<string, string> = {
  MET: "text-zinc-800 dark:text-zinc-200",
  NOT_MET: "text-zinc-600 dark:text-zinc-400",
  MISSING: "text-amber-800 dark:text-amber-300",
  CANNOT_EVALUATE: "text-amber-800 dark:text-amber-300",
};

export function ConditionList({ conditions }: { conditions: { text: string; outcome: string; state: string; reason?: string }[] }) {
  if (!conditions.length) return null;
  const list = (
    <ul className="flex flex-col gap-0.5 text-xs">
      {conditions.map((c, i) => (
        <li key={i} className={STATE_CLASS[c.state]}>
          If {c.text} → {label(c.outcome)}: <strong className="font-medium">{STATE_TEXT[c.state]}</strong>{c.reason && ` (${c.reason})`}
        </li>
      ))}
    </ul>
  );
  if (conditions.length <= 4) return list;
  // Long rule lists fold away; the count says what is inside.
  const open = conditions.filter((c) => c.state === "MISSING" || c.state === "CANNOT_EVALUATE").length;
  return (
    <details className="group">
      <summary className="flex w-fit list-none items-center gap-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
        <span aria-hidden="true" className="transition-transform duration-200 group-open:rotate-90">›</span>
        {conditions.length} conditions{open ? ` · ${open} can't be checked yet` : ""}
      </summary>
      <div className="mt-1.5 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">{list}</div>
    </details>
  );
}
