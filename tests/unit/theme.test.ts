import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, accentCss, contrast, normalizeHex, paletteFor } from "@/lib/theme";

/** Any picked color must keep text readable (WCAG AA 4.5:1). */
const PICKS = [...ACCENT_PRESETS.map((p) => p.hex), "#ffff00", "#00ffff", "#ffffff", "#000000", "#ff00ff", "#7fff00", "#808080", "#f5deb3"];

describe("accent palette", () => {
  it.each(PICKS)("%s keeps AA contrast for links, buttons and the sidebar", (hex) => {
    const p = paletteFor(hex);
    expect(contrast(p[700], "#ffffff")).toBeGreaterThanOrEqual(4.5); // links on white, white on buttons
    expect(contrast(p[800], "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p[600], "#ffffff")).toBeGreaterThanOrEqual(4.5); // white text on the sidebar
    expect(contrast(p[300], "#18181b")).toBeGreaterThanOrEqual(4.5); // dark-mode links on zinc-900
    expect(contrast(p[900], p[50])).toBeGreaterThanOrEqual(4.5); // text on light accent backgrounds
    for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps the hue of the pick", () => {
    const teal = paletteFor("#3a9e8a");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(teal[600].slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThanOrEqual(b - 10);
  });

  it("validates and emits CSS variables that remap the blue utilities", () => {
    expect(normalizeHex("#3A9E8A")).toBe("#3a9e8a");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#123")).toBeNull();
    expect(normalizeHex("#12345g")).toBeNull();
    const css = accentCss("#3a9e8a");
    expect(css).toMatch(/^:root\{/);
    expect(css).toContain("--color-blue-700:");
    expect(css).toContain("--accent-picked:#3a9e8a");
    expect(accentCss("not a color")).toContain("--accent-picked:#3a9e8a"); // falls back to the default
  });
});
