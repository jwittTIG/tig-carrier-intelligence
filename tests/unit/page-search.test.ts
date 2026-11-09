import { describe, expect, it } from "vitest";
import { pageAt, pagesDocument, selectPages, tokensOf } from "@/lib/page-search";

const filler = (n: number) => "Lorem ipsum general wording about the program. ".repeat(n);

describe("selectPages", () => {
  it("sends every page when the guides fit the budget (nothing can be missed)", () => {
    const guides = [{ pages: [{ number: 1, text: "Roof rules" }, { number: 2, text: "Dogs" }, { number: 3, text: "" }] }];
    expect(selectPages(guides, "wood shake roof?", 10_000)).toEqual([{ guide: 0, pages: [1, 2] }]); // blank page skipped
  });

  it("over budget: keeps the best-matching pages (rare words count more) and the page after a top hit", () => {
    const pages = Array.from({ length: 40 }, (_, i) => ({ number: i + 1, text: filler(60) }));
    pages[7].text += " Wood shake roofs are ineligible. Roof covering of wood shingles.";
    pages[8].text += " continued: overlay roofs.";
    pages[20].text += " Roof age over 25 years.";
    const budget = tokensOf(pages[0].text) * 4;
    const [pick] = selectPages([{ pages }], "Will they write a home with a wood shake roof?", budget);
    expect(pick.pages).toContain(8);
    expect(pick.pages).toContain(9); // the page after the top hit
    expect(pick.pages).toContain(21);
    expect(pick.pages.length).toBeLessThanOrEqual(4);
    expect(pick.pages).toEqual([...pick.pages].sort((a, b) => a - b));
  });

  it("returns no pages when no page uses the question's words", () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({ number: i + 1, text: filler(60) }));
    const [pick] = selectPages([{ pages }], "trampoline?", tokensOf(pages[0].text) * 3);
    expect(pick.pages).toEqual([]);
  });

  it("works across several guides", () => {
    const a = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, text: filler(60) }));
    const b = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, text: filler(60) }));
    b[4].text += " Drivers with 2 at-fault accidents are ineligible.";
    const picks = selectPages([{ pages: a }, { pages: b }], "2 at-fault accidents?", tokensOf(a[0].text) * 3);
    expect(picks[1].pages).toContain(5);
  });
});

describe("pagesDocument and pageAt", () => {
  it("marks each page and maps a character position back to its page", () => {
    const { text, spans } = pagesDocument([{ number: 7, text: "Heading" }, { number: 8, text: "Wood shake roofs are ineligible." }]);
    expect(text).toContain("=== Page 8 ===");
    const at = text.indexOf("Wood shake");
    expect(pageAt(spans, at)).toBe(8);
    expect(pageAt(spans, text.indexOf("Heading"))).toBe(7);
  });
});
