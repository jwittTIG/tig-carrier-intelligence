/**
 * Deterministic evaluation of appetite attribute conditions against risk values typed by
 * staff (DECISIONS D21). Pure functions, no database. Missing or non-comparable values are
 * reported as such and are never treated as a match.
 */

export type DataType = "TEXT" | "INTEGER" | "NUMBER" | "MONEY" | "BOOLEAN" | "DATE" | "ENUM";
export type Operator = "EQ" | "NEQ" | "IN" | "NOT_IN" | "LT" | "LTE" | "GT" | "GTE" | "BETWEEN" | "EXISTS";
export type ConditionState = "MET" | "NOT_MET" | "MISSING" | "CANNOT_EVALUATE";
export type Evaluation = { state: ConditionState; reason?: string };
type TypedValue = { value?: string; min?: string; max?: string; values?: string[] } | null | undefined;

const NUMERIC: DataType[] = ["INTEGER", "NUMBER", "MONEY"];
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Cleans a typed value for its data type. Returns an error message for bad input. */
export function normalizeInput(dataType: DataType, raw: string | undefined | null): { value: string | null; error?: string } {
  const v = (raw ?? "").trim();
  if (!v) return { value: null };
  if (NUMERIC.includes(dataType)) {
    const clean = v.replace(/[$,\s]/g, "");
    if (!DECIMAL.test(clean)) return { value: null, error: `"${v}" isn't a number` };
    if (dataType === "INTEGER" && clean.includes(".")) return { value: null, error: `"${v}" isn't a whole number` };
    return { value: clean };
  }
  if (dataType === "BOOLEAN") {
    const b = v.toLowerCase();
    if (!["yes", "no", "true", "false"].includes(b)) return { value: null, error: `"${v}" isn't yes or no` };
    return { value: String(b === "yes" || b === "true") };
  }
  if (dataType === "DATE") {
    const d = new Date(`${v}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return { value: null, error: `"${v}" isn't a date (YYYY-MM-DD)` };
    return { value: v };
  }
  return { value: v };
}

/** Compares two decimal strings exactly (no floating point). */
export function compareDecimal(a: string, b: string): number {
  const neg = (s: string) => s.startsWith("-");
  const abs = (s: string) => (neg(s) ? s.slice(1) : s);
  if (neg(a) !== neg(b)) {
    const zero = (s: string) => /^-?0*(\.0*)?$/.test(s);
    if (zero(a) && zero(b)) return 0;
    return neg(a) ? -1 : 1;
  }
  const [ai, af = ""] = abs(a).split(".");
  const [bi, bf = ""] = abs(b).split(".");
  const intA = ai.replace(/^0+(?=\d)/, ""), intB = bi.replace(/^0+(?=\d)/, "");
  const len = Math.max(af.length, bf.length);
  const fa = af.padEnd(len, "0"), fb = bf.padEnd(len, "0");
  let c = intA.length !== intB.length ? intA.length - intB.length : intA < intB ? -1 : intA > intB ? 1 : fa < fb ? -1 : fa > fb ? 1 : 0;
  c = Math.sign(c);
  return neg(a) ? -c : c;
}

function cmp(dataType: DataType, a: string, b: string): number | null {
  if (NUMERIC.includes(dataType)) {
    const x = a.replace(/[$,\s]/g, ""), y = b.replace(/[$,\s]/g, "");
    return DECIMAL.test(x) && DECIMAL.test(y) ? compareDecimal(x, y) : null;
  }
  if (dataType === "DATE") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function same(dataType: DataType, a: string, b: string): boolean | null {
  if (NUMERIC.includes(dataType) || dataType === "DATE") {
    const c = cmp(dataType, a, b);
    return c === null ? null : c === 0;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Evaluates one condition. `input` must already be normalized (normalizeInput).
 * Returns MISSING when no value was entered, CANNOT_EVALUATE when the rule can't be compared.
 */
export function evaluateCondition(dataType: DataType, operator: Operator, typed: TypedValue, input: string | null): Evaluation {
  if (input === null) return { state: "MISSING" };
  if (operator === "EXISTS") return { state: "MET" };
  const t = typed ?? {};
  const result = (b: boolean | null, why = "the rule's value can't be compared") => (b === null ? { state: "CANNOT_EVALUATE" as const, reason: why } : { state: b ? ("MET" as const) : ("NOT_MET" as const) });
  switch (operator) {
    case "EQ":
    case "NEQ": {
      if (t.value === undefined) return result(null);
      const s = same(dataType, input, t.value);
      return result(s === null ? null : operator === "EQ" ? s : !s);
    }
    case "IN":
    case "NOT_IN": {
      if (!t.values) return result(null);
      const hits = t.values.map((v) => same(dataType, input, v));
      if (hits.some((h) => h === null)) return result(null);
      const any = hits.some(Boolean);
      return result(operator === "IN" ? any : !any);
    }
    case "LT":
    case "LTE":
    case "GT":
    case "GTE": {
      if (t.value === undefined) return result(null);
      const c = cmp(dataType, input, t.value);
      if (c === null) return result(null, `"${operator}" needs a number, amount or date`);
      return result(operator === "LT" ? c < 0 : operator === "LTE" ? c <= 0 : operator === "GT" ? c > 0 : c >= 0);
    }
    case "BETWEEN": {
      if (t.min === undefined || t.max === undefined) return result(null);
      const lo = cmp(dataType, input, t.min), hi = cmp(dataType, input, t.max);
      if (lo === null || hi === null) return result(null, '"between" needs a number, amount or date');
      return result(lo >= 0 && hi <= 0);
    }
  }
}

export type CandidateRule = { id: string; outcome: string; priority: number; specificity: number; evaluation: Evaluation | null };

/**
 * Chooses the outcome from candidate rules that already match by state, class and date.
 * `evaluation` is null for rules without an attribute condition (they always apply).
 * Order: priority ascending, then specificity descending, then id (stable).
 * Blockers: rules ranked ahead of the chosen one whose condition is MISSING or
 * CANNOT_EVALUATE and whose outcome differs, i.e. they could change the answer.
 */
export function chooseOutcome<R extends CandidateRule>(rules: R[]): { chosen: R | null; applying: R[]; blockers: R[] } {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || b.specificity - a.specificity || a.id.localeCompare(b.id));
  const applies = (r: R) => r.evaluation === null || r.evaluation.state === "MET";
  const unknown = (r: R) => r.evaluation !== null && (r.evaluation.state === "MISSING" || r.evaluation.state === "CANNOT_EVALUATE");
  const idx = ordered.findIndex(applies);
  const chosen = idx >= 0 ? ordered[idx] : null;
  const ahead = idx >= 0 ? ordered.slice(0, idx) : ordered;
  const blockers = ahead.filter((r) => unknown(r) && r.outcome !== (chosen?.outcome ?? "UNKNOWN"));
  return { chosen, applying: ordered.filter(applies), blockers };
}
