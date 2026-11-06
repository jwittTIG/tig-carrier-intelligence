import { describe, expect, it } from "vitest";
import { chooseOutcome, compareDecimal, evaluateCondition, normalizeInput } from "@/lib/matching";

describe("normalizeInput", () => {
  it("cleans numbers and money, rejects bad input", () => {
    expect(normalizeInput("MONEY", "$5,000,000")).toEqual({ value: "5000000" });
    expect(normalizeInput("INTEGER", "12.5").error).toMatch(/whole number/);
    expect(normalizeInput("NUMBER", "lots").error).toMatch(/isn't a number/);
    expect(normalizeInput("BOOLEAN", "Yes")).toEqual({ value: "true" });
    expect(normalizeInput("BOOLEAN", "maybe").error).toMatch(/yes or no/);
    expect(normalizeInput("DATE", "2026-02-28")).toEqual({ value: "2026-02-28" });
    expect(normalizeInput("DATE", "2026-02-30").error).toMatch(/isn't a date/);
    expect(normalizeInput("DATE", "02/01/2026").error).toMatch(/YYYY-MM-DD/);
    expect(normalizeInput("TEXT", "  ")).toEqual({ value: null });
  });
});

describe("compareDecimal (exact, no floating point)", () => {
  it.each([
    ["5000000", "5000000.00", 0],
    ["0.1", "0.10000000000000001", -1],
    ["-2", "1", -1],
    ["10", "9.999", 1],
    ["-0", "0", 0],
    ["-3.5", "-3.25", -1],
    ["007", "7", 0],
  ])("%s vs %s → %i", (a, b, c) => expect(compareDecimal(a, b)).toBe(c));
});

describe("evaluateCondition", () => {
  const ev = (dt: Parameters<typeof evaluateCondition>[0], op: Parameters<typeof evaluateCondition>[1], typed: Parameters<typeof evaluateCondition>[2], v: string | null) => evaluateCondition(dt, op, typed, v).state;

  it("missing input is MISSING, never a match", () => {
    for (const op of ["EQ", "NEQ", "LT", "GT", "BETWEEN", "IN", "NOT_IN", "EXISTS"] as const) {
      expect(ev("MONEY", op, { value: "1", min: "1", max: "2", values: ["1"] }, null)).toBe("MISSING");
    }
  });

  it("compares money and numbers", () => {
    expect(ev("MONEY", "LTE", { value: "5000000" }, "5000000")).toBe("MET");
    expect(ev("MONEY", "LT", { value: "5000000" }, "5000000")).toBe("NOT_MET");
    expect(ev("MONEY", "GT", { value: "5000000" }, "5000000.01")).toBe("MET");
    expect(ev("NUMBER", "GTE", { value: "3" }, "2.99")).toBe("NOT_MET");
    expect(ev("INTEGER", "BETWEEN", { min: "1", max: "10" }, "10")).toBe("MET");
    expect(ev("INTEGER", "BETWEEN", { min: "1", max: "10" }, "11")).toBe("NOT_MET");
    expect(ev("NUMBER", "EQ", { value: "2.50" }, "2.5")).toBe("MET");
    expect(ev("NUMBER", "NEQ", { value: "2.50" }, "2.5")).toBe("NOT_MET");
    expect(ev("INTEGER", "IN", { values: ["1", "2"] }, "2")).toBe("MET");
    expect(ev("INTEGER", "NOT_IN", { values: ["1", "2"] }, "2")).toBe("NOT_MET");
  });

  it("compares dates", () => {
    expect(ev("DATE", "LT", { value: "2000-01-01" }, "1999-12-31")).toBe("MET");
    expect(ev("DATE", "BETWEEN", { min: "2020-01-01", max: "2020-12-31" }, "2021-01-01")).toBe("NOT_MET");
  });

  it("text, enum and boolean compare case-insensitively", () => {
    expect(ev("TEXT", "EQ", { value: "Frame" }, "frame")).toBe("MET");
    expect(ev("ENUM", "IN", { values: ["Frame", "Joisted masonry"] }, "JOISTED MASONRY")).toBe("MET");
    expect(ev("ENUM", "NOT_IN", { values: ["Frame"] }, "Masonry")).toBe("MET");
    expect(ev("BOOLEAN", "EQ", { value: "true" }, "true")).toBe("MET");
    expect(ev("BOOLEAN", "EQ", { value: "true" }, "false")).toBe("NOT_MET");
    expect(ev("TEXT", "EXISTS", null, "anything")).toBe("MET");
  });

  it("can't order text, and says why", () => {
    const r = evaluateCondition("TEXT", "GT", { value: "b" }, "c");
    expect(r.state).toBe("CANNOT_EVALUATE");
    expect(r.reason).toMatch(/number, amount or date/);
    expect(ev("MONEY", "EQ", {}, "1")).toBe("CANNOT_EVALUATE");
    expect(ev("MONEY", "LT", { value: "abc" }, "1")).toBe("CANNOT_EVALUATE");
  });
});

describe("chooseOutcome", () => {
  const rule = (id: string, outcome: string, o: { priority?: number; specificity?: number; state?: "MET" | "NOT_MET" | "MISSING" | "CANNOT_EVALUATE" } = {}) => ({
    id, outcome, priority: o.priority ?? 100, specificity: o.specificity ?? 0, evaluation: o.state ? { state: o.state } : null,
  });

  it("first applying rule by priority then specificity", () => {
    const r = chooseOutcome([rule("a", "ACCEPTED"), rule("b", "PROHIBITED", { specificity: 2 }), rule("c", "PREFERRED", { priority: 10 })]);
    expect(r.chosen?.id).toBe("c");
    expect(r.blockers).toEqual([]);
  });

  it("a condition that isn't met doesn't apply", () => {
    const r = chooseOutcome([rule("a", "ACCEPTED"), rule("b", "PROHIBITED", { specificity: 4, state: "NOT_MET" })]);
    expect(r.chosen?.outcome).toBe("ACCEPTED");
    expect(r.applying.map((x) => x.id)).toEqual(["a"]);
  });

  it("a met condition outranks a general rule", () => {
    expect(chooseOutcome([rule("a", "ACCEPTED"), rule("b", "PROHIBITED", { specificity: 4, state: "MET" })]).chosen?.outcome).toBe("PROHIBITED");
  });

  it("a missing value ranked ahead with a different outcome blocks the result", () => {
    const r = chooseOutcome([rule("a", "ACCEPTED"), rule("b", "PROHIBITED", { specificity: 4, state: "MISSING" })]);
    expect(r.chosen?.outcome).toBe("ACCEPTED");
    expect(r.blockers.map((x) => x.id)).toEqual(["b"]);
  });

  it("a missing value that can't change the outcome doesn't block", () => {
    expect(chooseOutcome([rule("a", "ACCEPTED"), rule("b", "ACCEPTED", { specificity: 4, state: "MISSING" })]).blockers).toEqual([]);
    // Ranked behind the chosen rule: irrelevant.
    expect(chooseOutcome([rule("a", "ACCEPTED", { priority: 1 }), rule("b", "PROHIBITED", { specificity: 4, state: "MISSING" })]).blockers).toEqual([]);
  });

  it("with nothing applying, a missing value that could give an outcome blocks UNKNOWN", () => {
    const r = chooseOutcome([rule("b", "ACCEPTED", { specificity: 4, state: "CANNOT_EVALUATE" })]);
    expect(r.chosen).toBeNull();
    expect(r.blockers.map((x) => x.id)).toEqual(["b"]);
    expect(chooseOutcome([]).chosen).toBeNull();
  });
});
