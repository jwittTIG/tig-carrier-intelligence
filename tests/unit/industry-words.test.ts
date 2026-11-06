import { describe, expect, it } from "vitest";
import { queryStems, stem, titleMatches } from "@/lib/industry-words";

describe("industry word matching", () => {
  it.each([
    ["roofer", "roof"],
    ["roofers", "roof"],
    ["roofing", "roof"],
    ["Roofing", "roof"],
    ["plumber", "plumb"],
    ["electrician", "electric"],
    ["Electrical", "electric"],
    ["bakeries", "bakery"],
    ["shipping", "ship"],
    ["installing", "install"],
    ["restaurant's", "restaurant"],
    ["gas", "gas"], // too short to strip
  ])("%s → %s", (w, s) => expect(stem(w)).toBe(s));

  it("drops stop words and short fragments", () => {
    expect(queryStems("Roofing and siding contractors")).toEqual(["roof", "sid", "contractor"]);
    expect(queryStems("the of and")).toEqual([]);
  });

  it("every word must start a word of the title", () => {
    expect(titleMatches("Roofing Contractors", queryStems("roofer"))).toBe(true);
    expect(titleMatches("Roofing Contractors", queryStems("roofing contractor"))).toBe(true);
    expect(titleMatches("Roofing, Siding, and Insulation Material Merchant Wholesalers", queryStems("roofer"))).toBe(true);
    expect(titleMatches("Electrical Contractors and Other Wiring Installation Contractors", queryStems("electrician"))).toBe(true);
    expect(titleMatches("Retail Bakeries", queryStems("bakery"))).toBe(true);
    expect(titleMatches("Roofing Contractors", queryStems("roofing plumbing"))).toBe(false);
    expect(titleMatches("Proofreading services", queryStems("roof"))).toBe(false); // whole-word start, not substring
    expect(titleMatches("Anything", [])).toBe(false);
  });
});
