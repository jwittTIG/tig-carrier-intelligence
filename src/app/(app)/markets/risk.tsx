import { inputClass, label } from "@/components/ui";

/** Shared pieces for the Market Finder and the comparison (DECISIONS D21–D22). */

export function firstValues(sp: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

type Attribute = { key: string; label: string; dataType: string; unit: string | null };

const PLACEHOLDER: Record<string, string> = { MONEY: "5,000,000", NUMBER: "12.5", INTEGER: "25", DATE: "YYYY-MM-DD", BOOLEAN: "yes or no" };

export function RiskAttributeInputs({ attributes, values, asked }: { attributes: Attribute[]; values: Record<string, string | undefined>; asked: boolean }) {
  if (!asked) return null;
  if (!attributes.length) {
    return <p className="text-xs text-zinc-500">No risk details (revenue, TIV…) are defined for this product. They are added on an appetite draft.</p>;
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Risk details (optional; not saved)</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {attributes.map((a) => (
          <label key={a.key} className="flex flex-col gap-1 text-sm">
            {a.label}{a.unit ? ` (${a.unit})` : ""}
            {a.dataType === "BOOLEAN" ? (
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
      <p className="text-xs text-zinc-500">Enter only what describes the risk. No client names are needed.</p>
    </fieldset>
  );
}

const STATE_TEXT: Record<string, string> = { MET: "met", NOT_MET: "not met", MISSING: "not entered", CANNOT_EVALUATE: "can't be checked" };
const STATE_CLASS: Record<string, string> = {
  MET: "text-zinc-800 dark:text-zinc-200",
  NOT_MET: "text-zinc-500",
  MISSING: "text-amber-800 dark:text-amber-300",
  CANNOT_EVALUATE: "text-amber-800 dark:text-amber-300",
};

export function ConditionList({ conditions }: { conditions: { text: string; outcome: string; state: string; reason?: string }[] }) {
  if (!conditions.length) return null;
  return (
    <ul className="text-xs">
      {conditions.map((c, i) => (
        <li key={i} className={STATE_CLASS[c.state]}>
          If {c.text} → {label(c.outcome)}: <strong>{STATE_TEXT[c.state]}</strong>{c.reason && ` (${c.reason})`}
        </li>
      ))}
    </ul>
  );
}
