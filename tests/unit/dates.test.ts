import { describe, expect, it } from "vitest";
import { effectiveState, freshness, rangesOverlap, withinParent } from "@/lib/dates";
import { looksLikeCredential } from "@/server/services/appointments";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = d("2026-11-05");
const state = (status: string, from: string | null, to: string | null) =>
  effectiveState({ status, effectiveFrom: from ? d(from) : null, effectiveTo: to ? d(to) : null }, { today, warningDays: 60 });

describe("effectiveState", () => {
  it("never shows an ACTIVE record past its end date as current", () => {
    expect(state("ACTIVE", "2025-01-01", "2026-11-04")).toBe("EXPIRED");
    expect(state("ACTIVE", "2025-01-01", "2026-11-05")).toBe("EXPIRING_SOON"); // end date is inclusive
  });
  it("flags expiring soon within the warning window and future starts", () => {
    expect(state("ACTIVE", "2025-01-01", "2027-01-04")).toBe("EXPIRING_SOON");
    expect(state("ACTIVE", "2025-01-01", "2027-01-05")).toBe("CURRENT");
    expect(state("ACTIVE", "2026-12-01", null)).toBe("NOT_YET_EFFECTIVE");
    expect(state("ACTIVE", null, null)).toBe("CURRENT");
  });
  it("treats any non-ACTIVE status as not active, whatever the dates", () => {
    for (const s of ["PENDING", "SUSPENDED", "TERMINATED", "INACTIVE"]) expect(state(s, "2025-01-01", null)).toBe("NOT_ACTIVE");
  });
  it("a code is never more current than its appointment", () => {
    expect(withinParent("CURRENT", "EXPIRED")).toBe("EXPIRED");
    expect(withinParent("CURRENT", "NOT_ACTIVE")).toBe("NOT_ACTIVE");
    expect(withinParent("CURRENT", "EXPIRING_SOON")).toBe("EXPIRING_SOON");
    expect(withinParent("NOT_ACTIVE", "CURRENT")).toBe("NOT_ACTIVE");
    expect(withinParent("CURRENT", "CURRENT")).toBe("CURRENT");
  });
});

describe("freshness", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  it("is never-verified without a date, stale after the cadence, fresh before", () => {
    expect(freshness(null, 365, now).state).toBe("NEVER_VERIFIED");
    expect(freshness(new Date("2025-11-04T12:00:00Z"), 365, now).state).toBe("STALE");
    expect(freshness(new Date("2026-01-01T00:00:00Z"), 365, now)).toEqual({ state: "FRESH", nextReviewAt: new Date("2027-01-01T00:00:00Z") });
  });
});

describe("rangesOverlap", () => {
  it("handles inclusive and open-ended ranges", () => {
    expect(rangesOverlap(d("2026-01-01"), d("2026-06-30"), d("2026-06-30"), null)).toBe(true);
    expect(rangesOverlap(d("2026-01-01"), d("2026-06-30"), d("2026-07-01"), null)).toBe(false);
    expect(rangesOverlap(d("2026-01-01"), null, d("2030-01-01"), d("2030-02-01"))).toBe(true);
  });
});

describe("portal credential guard", () => {
  it.each(["Password: hunter2", "pwd=abc", "PIN: 1234", "username: jsmith / pass abc123", "security answer: Fluffy", "MFA seed: JBSWY3DP"])("flags %s", (t) => {
    expect(looksLikeCredential(t)).toBe(true);
  });
  it.each(["Password manager › Carriers › Summit", "Ask Pat for access", "Login lives in the shared vault", null])("allows %s", (t) => {
    expect(looksLikeCredential(t)).toBe(false);
  });
});
