import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { headingFromItems, titleFromFileName, usablePdfTitle } = await import("@/server/storage/title");
const { withCarrier } = await import("@/server/services/documents");

describe("a PDF's own title", () => {
  it("keeps real titles and rejects file names and word-processor defaults", () => {
    expect(usablePdfTitle("TN Quantum Homeowners 2.0 Manual")).toBe("TN Quantum Homeowners 2.0 Manual");
    expect(usablePdfTitle("Microsoft Word - Homeowners Program Guide.docx")).toBe("Homeowners Program Guide");
    expect(usablePdfTitle("tna_pg.pdf")).toBeNull();
    expect(usablePdfTitle("TNH-EG-2026")).toBeNull(); // one word
    expect(usablePdfTitle("Untitled")).toBeNull();
    expect(usablePdfTitle("")).toBeNull();
    expect(usablePdfTitle(undefined)).toBeNull();
  });
});

describe("the page-1 heading", () => {
  const item = (str: string, height: number, y: number, x = 50) => ({ str, height, y, x });

  it("takes the top line of the largest text, without dates", () => {
    expect(headingFromItems([
      item("05/12/2026", 20, 760),
      item("Tennessee RV & Advantage", 20, 730),
      item("Personal Auto", 20, 730, 300),
      item("TENNESSEE", 20, 690),
      item("Integon General Insurance Corporation", 20, 650),
      item("Body text of the guide", 10, 600),
    ])).toBe("Tennessee RV & Advantage Personal Auto");
  });

  it("joins a short title that wraps onto the next line", () => {
    expect(headingFromItems([item("Homeowners", 24, 700), item("Underwriting Guide", 24, 674), item("Effective 2026", 10, 600)])).toBe("Homeowners Underwriting Guide");
  });

  it("falls back to the next size when the largest text isn't words, and gives up on no text", () => {
    expect(headingFromItems([item("1", 40, 700), item("Product Guide", 18, 650)])).toBe("Product Guide");
    expect(headingFromItems([])).toBeNull();
  });
});

describe("file names and carrier names", () => {
  it("tidies a file name", () => {
    expect(titleFromFileName("Travelers_Quantum-Home_2.0 (2026).pdf")).toBe("Travelers Quantum Home 2.0 (2026)");
    expect(titleFromFileName(".pdf")).toBe("Untitled document");
  });

  it("puts the carrier first when the title doesn't name it", () => {
    expect(withCarrier("Product Guide", "Liberty Mutual (Safeco)")).toBe("Liberty Mutual (Safeco) – Product Guide");
    expect(withCarrier("Travelers Quantum Home 2.0", "Travelers")).toBe("Travelers Quantum Home 2.0");
    expect(withCarrier("Product Guide", null)).toBe("Product Guide");
  });
});
