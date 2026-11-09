import { describe, expect, it } from "vitest";
import { estimateCost, parseVerdict } from "@/server/ai/guide-reader";
import { detectCarrier } from "@/server/services/guides";

describe("parseVerdict", () => {
  it.each([
    ["Verdict: YES\nThey write it.", "YES", "They write it."],
    ["verdict: no\nProhibited on p.4", "NO", "Prohibited on p.4"],
    ["**Verdict: REFER**\nSubmit to UW.", "REFER", "Submit to UW."],
    ["Verdict: NOT_ADDRESSED\nNothing on roofs.", "NOT_ADDRESSED", "Nothing on roofs."],
    ["Verdict: Not addressed\nNothing.", "NOT_ADDRESSED", "Nothing."],
  ])("%j → %s", (text, verdict, rest) => {
    expect(parseVerdict(text)).toEqual({ verdict, rest });
  });

  it("anything without a clear verdict line is UNCLEAR, never yes", () => {
    expect(parseVerdict("Yes, probably.").verdict).toBe("UNCLEAR");
    expect(parseVerdict("The guide says yes.\nVerdict: YES").verdict).toBe("UNCLEAR");
    expect(parseVerdict("").verdict).toBe("UNCLEAR");
  });
});

describe("estimateCost", () => {
  it("prices fresh input, cache writes, cache reads and output (Opus 5.5 list prices)", () => {
    expect(estimateCost({ input_tokens: 1_000_000 })).toBe(4);
    expect(estimateCost({ cache_creation_input_tokens: 1_000_000 })).toBe(5);
    expect(estimateCost({ cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(estimateCost({ output_tokens: 1_000_000 })).toBe(20);
    // A follow-up question on a cached 250k-token guide: about 7 cents.
    expect(estimateCost({ input_tokens: 50, cache_read_input_tokens: 250_000, output_tokens: 800 })).toBeCloseTo(0.0662, 3);
  });

  it("prices the page-text reader at Haiku 5.5 rates, with the higher tier over 100k prompt tokens", () => {
    // A 50k-token guide read whole: about half a cent.
    expect(estimateCost({ input_tokens: 50_000, output_tokens: 800 }, "haiku")).toBeCloseTo(0.0054, 4);
    expect(estimateCost({ input_tokens: 100_000 }, "haiku")).toBeCloseTo(0.01);
    expect(estimateCost({ input_tokens: 1_000_000 }, "haiku")).toBe(0.5); // over 100k: long-prompt price
  });
});

describe("detectCarrier", () => {
  const carriers = [
    { id: "a", displayName: "Travelers", legalName: "Travelers Insurance Company" },
    { id: "b", displayName: "Travelers Excess", legalName: "Travelers Excess and Surplus Lines Co" },
    { id: "c", displayName: "Summit", legalName: "Summit Mutual" },
  ];
  it("finds the carrier named in the question, preferring the longest name", () => {
    expect(detectCarrier("Will Travelers write a home with a wood shake roof?", carriers)?.id).toBe("a");
    expect(detectCarrier("Does travelers excess take roofers?", carriers)?.id).toBe("b");
    expect(detectCarrier("summit mutual: frame dwellings?", carriers)?.id).toBe("c");
  });
  it("needs whole words and returns nothing when no carrier is named", () => {
    expect(detectCarrier("Who writes wood shake roofs?", carriers)).toBeNull();
    expect(detectCarrier("summitry", carriers)).toBeNull();
  });
});
