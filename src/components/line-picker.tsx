/**
 * Lines of business grouped into Personal lines and Commercial lines (Josh, 2026-11-16), for
 * dropdowns (<optgroup>s) and checkbox pickers. The group comes from lines_of_business.segment.
 */
type Line = { id: string; name: string; segment: string };

export const SEGMENTS = [
  { key: "PERSONAL", label: "Personal lines" },
  { key: "COMMERCIAL", label: "Commercial lines" },
] as const;

const bySegment = <T extends { segment: string }>(items: T[]) =>
  SEGMENTS.map((s) => ({ ...s, items: items.filter((i) => (i.segment === "PERSONAL" ? "PERSONAL" : "COMMERCIAL") === s.key) })).filter((g) => g.items.length);

/** <option>s for a line dropdown, grouped. */
export function LineOptions({ lines }: { lines: Line[] }) {
  return (
    <>
      {bySegment(lines).map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.items.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}

/** <option>s for a product dropdown ("Line: Product"), grouped by the product's line. */
export function ProductOptions({ products }: { products: { id: string; name: string; line: { name: string; segment: string } }[] }) {
  return (
    <>
      {bySegment(products.map((p) => ({ ...p, segment: p.line.segment }))).map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.items.map((p) => <option key={p.id} value={p.id}>{p.line.name}: {p.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}

/**
 * Checkboxes for the lines a carrier writes, in a Personal lines and a Commercial lines column.
 * `added` lines show ticked and disabled.
 */
export function LineCheckboxes({ lines, name = "lineIds", added = new Set<string>(), legend, hint }: { lines: Line[]; name?: string; added?: Set<string>; legend: string; hint?: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{legend}</legend>
      {hint && <p className="-mt-1 text-xs text-zinc-600 dark:text-zinc-400">{hint}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {bySegment(lines).map((g) => (
          <div key={g.key} role="group" aria-label={g.label} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400">{g.label}</p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {g.items.map((l) => {
                const has = added.has(l.id);
                return (
                  <label key={l.id} className={`flex items-center gap-2 text-[13px] ${has ? "text-zinc-600 dark:text-zinc-400" : "text-zinc-800 dark:text-zinc-200"}`}>
                    <input type="checkbox" name={name} value={l.id} defaultChecked={has} disabled={has} />
                    {l.name}{has && <span className="text-xs"> (added)</span>}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
