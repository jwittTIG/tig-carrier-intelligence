/** Pure helpers for scripts/move-data.ts (unit-tested in tests/unit/move-data.test.ts). */

export type ForeignKey = { child: string; parent: string; columns: string[]; refs: string[] };

/**
 * Tables in an order where every table comes after the tables it points to (foreign keys).
 * A table pointing to itself is fine (see orderSelfReferencing); a cycle between tables is not.
 */
export function insertOrder(tables: string[], fks: ForeignKey[]): string[] {
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const f of fks) if (f.child !== f.parent && deps.has(f.child) && deps.has(f.parent)) deps.get(f.child)!.add(f.parent);
  const done: string[] = [];
  const placed = new Set<string>();
  while (done.length < tables.length) {
    const ready = tables.filter((t) => !placed.has(t) && [...deps.get(t)!].every((d) => placed.has(d)));
    if (!ready.length) throw new Error(`Foreign keys form a cycle between: ${tables.filter((t) => !placed.has(t)).join(", ")}`);
    for (const t of ready) {
      placed.add(t);
      done.push(t);
    }
  }
  return done;
}

/** Rows of a table that points to itself (e.g. a carrier's parent group), parents first. */
export function orderSelfReferencing<R extends Record<string, unknown>>(rows: R[], selfRefs: ForeignKey[]): R[] {
  const key = (row: R, cols: string[]) => JSON.stringify(cols.map((c) => row[c]));
  const inserted = selfRefs.map(() => new Set<string>());
  const remember = (row: R) => selfRefs.forEach((f, i) => inserted[i].add(key(row, f.refs)));
  const out: R[] = [];
  let pending = rows;
  while (pending.length) {
    const next: R[] = [];
    for (const row of pending) {
      const ok = selfRefs.every((f, i) => f.columns.some((c) => row[c] === null || row[c] === undefined) || inserted[i].has(key(row, f.columns)));
      if (ok) {
        out.push(row);
        remember(row);
      } else next.push(row);
    }
    if (next.length === pending.length) throw new Error("Rows point to each other in a loop (or to a missing row); can't order them.");
    pending = next;
  }
  return out;
}
