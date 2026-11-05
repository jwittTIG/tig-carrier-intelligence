/**
 * Date rules shared by services and screens. Pure functions, unit-tested.
 * Effective dates are calendar dates (UTC midnight); effective_to is inclusive.
 */

const DAY = 24 * 60 * 60 * 1000;

export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY);
}

export type EffectiveState = "CURRENT" | "EXPIRING_SOON" | "EXPIRED" | "NOT_YET_EFFECTIVE" | "NOT_ACTIVE";

/**
 * Where an effective-dated record stands today. A record whose status says ACTIVE but whose
 * end date has passed is EXPIRED, never CURRENT (ACCEPTANCE_TESTS: expired appointments
 * are not displayed as currently active).
 */
export function effectiveState(
  r: { status: string; effectiveFrom: Date | null; effectiveTo: Date | null },
  opts: { today?: Date; warningDays: number },
): EffectiveState {
  const today = opts.today ?? todayUtc();
  if (r.status !== "ACTIVE") return "NOT_ACTIVE";
  if (r.effectiveTo && r.effectiveTo < today) return "EXPIRED";
  if (r.effectiveFrom && r.effectiveFrom > today) return "NOT_YET_EFFECTIVE";
  if (r.effectiveTo && r.effectiveTo <= addDays(today, opts.warningDays)) return "EXPIRING_SOON";
  return "CURRENT";
}

/**
 * State of a child record (an agency code) under its parent (the appointment): a code is
 * never more current than its appointment.
 */
export function withinParent(own: EffectiveState, parent: EffectiveState): EffectiveState {
  const live = (s: EffectiveState) => s === "CURRENT" || s === "EXPIRING_SOON";
  if (!live(own)) return own;
  if (!live(parent)) return parent;
  return own === "EXPIRING_SOON" || parent === "EXPIRING_SOON" ? "EXPIRING_SOON" : "CURRENT";
}

export const EFFECTIVE_LABEL: Record<EffectiveState, string> = {
  CURRENT: "Current",
  EXPIRING_SOON: "Expiring soon",
  EXPIRED: "Expired",
  NOT_YET_EFFECTIVE: "Not yet effective",
  NOT_ACTIVE: "Not active",
};

export type Freshness = { state: "FRESH" | "STALE" | "NEVER_VERIFIED"; nextReviewAt: Date | null };

/** Verification freshness: stale once `cadenceDays` have passed since the last verification. */
export function freshness(verifiedAt: Date | null, cadenceDays: number, now: Date = new Date()): Freshness {
  if (!verifiedAt) return { state: "NEVER_VERIFIED", nextReviewAt: null };
  const next = addDays(verifiedAt, cadenceDays);
  return { state: next <= now ? "STALE" : "FRESH", nextReviewAt: next };
}

/** True when two inclusive date ranges overlap (null end = open-ended). */
export function rangesOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  return (aTo === null || bFrom <= aTo) && (bTo === null || aFrom <= bTo);
}
