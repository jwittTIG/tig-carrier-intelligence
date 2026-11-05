import { describe, expect, it } from "vitest";
import { normalizeName, parseCsv, similarity, toCsv } from "@/lib/csv";

describe("CSV", () => {
  it("parses quotes, escaped quotes, embedded commas/newlines, CRLF, BOM and blank lines", () => {
    const text = '﻿Name,Notes\r\n"Summit, Inc.","Says ""hi""\nsecond line"\r\n\r\nRidgeline,\n';
    expect(parseCsv(text)).toEqual([["Name", "Notes"], ["Summit, Inc.", 'Says "hi"\nsecond line'], ["Ridgeline", ""]]);
  });
  it("rejects an unclosed quote", () => {
    expect(() => parseCsv('a,"b\nc')).toThrow(/unclosed quote/);
  });
  it("writes quoted cells and neutralizes formulas", () => {
    expect(toCsv([["=1+1", 'a"b', null, new Date("2026-01-02T00:00:00Z")]])).toBe(`"'=1+1","a""b","","2026-01-02"\r\n`);
  });
  it("normalizes company names and scores similarity", () => {
    expect(normalizeName("The Summit Mutual Insurance Co., Inc.")).toBe("summit mutual insurance");
    expect(normalizeName("A&B Casualty LLC")).toBe("a and b casualty");
    expect(similarity("Summit Mutual", "Summit Mutual Ins")).toBeGreaterThan(0.6);
    expect(similarity("Summit Mutual", "Ridgeline Specialty")).toBeLessThan(0.2);
  });
});
