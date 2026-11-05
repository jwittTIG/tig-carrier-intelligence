/**
 * TIG Carrier Intelligence covers P&C, specialty and surety only. Life, health, employee
 * benefits, disability, long-term care and medical lines are excluded entirely
 * (docs/PRD.md "Scope"). Used by the seed now and by line/product forms later.
 */
const EXCLUDED = [
  /\blife\b/i,
  /\bhealth\b/i,
  /\bbenefits?\b/i,
  /\bdisabilit(y|ies)\b/i,
  /\blong[- ]term care\b/i,
  /\bltc\b/i,
  /\bmedical (plan|network|insurance)s?\b/i,
  /\bdental\b/i,
  /\bvision\b/i,
  /\benrol(l)?ment\b/i,
];

export function excludedLineReason(name: string): string | null {
  const hit = EXCLUDED.find((re) => re.test(name));
  return hit ? `"${name}" is outside P&C scope (life/health/benefits lines are excluded)` : null;
}

export function assertPropertyCasualtyLine(name: string): void {
  const reason = excludedLineReason(name);
  if (reason) throw new Error(reason);
}
