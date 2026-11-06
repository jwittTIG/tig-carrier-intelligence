/**
 * Accent color theme. Staff pick one color; we derive a full 50–950 scale from it in OKLCH,
 * keeping its hue but fixing each shade's lightness, so text and buttons keep the same
 * contrast whatever color is picked (WCAG AA: shade 700 on white, white on 600/700).
 * Pure functions, no DOM.
 */

export const ACCENT_COOKIE = "tci-accent";
export const DEFAULT_ACCENT = "#3a9e8a";

export const ACCENT_PRESETS = [
  { name: "Teal", hex: "#3a9e8a" },
  { name: "Blue", hex: "#2563eb" },
  { name: "Indigo", hex: "#4f46e5" },
  { name: "Purple", hex: "#9333ea" },
  { name: "Rose", hex: "#e11d48" },
  { name: "Orange", hex: "#ea580c" },
  { name: "Green", hex: "#16a34a" },
  { name: "Slate", hex: "#475569" },
] as const;

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const LIGHTNESS = [0.975, 0.945, 0.89, 0.82, 0.72, 0.63, 0.545, 0.48, 0.42, 0.37, 0.28];
const CHROMA = [0.12, 0.25, 0.5, 0.75, 0.92, 1, 1, 0.95, 0.85, 0.75, 0.6];

export function normalizeHex(value: string | undefined | null): string | null {
  const v = (value ?? "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

// ── sRGB ⇄ OKLab (Björn Ottosson's reference matrices) ──
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255) as [number, number, number];
}

function rgbToOklch([r, g, b]: [number, number, number]): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** Linear sRGB for an OKLCH color (may be out of gamut). */
function oklchToLinear(L: number, C: number, h: number): [number, number, number] {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -0.0001 && c <= 1.0001);

/** OKLCH → hex, lowering chroma until the color fits in sRGB. */
function oklchToHex(L: number, C: number, h: number): string {
  let c = C;
  let lin = oklchToLinear(L, c, h);
  for (let i = 0; i < 30 && !inGamut(lin); i++) {
    c *= 0.9;
    lin = oklchToLinear(L, c, h);
  }
  return "#" + lin.map((x) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, x))))) * 255).toString(16).padStart(2, "0")).join("");
}

export type Palette = Record<(typeof SHADES)[number], string>;

export function paletteFor(hex: string): Palette {
  const [, C, h] = rgbToOklch(hexToRgb(normalizeHex(hex) ?? DEFAULT_ACCENT));
  // Greys (e.g. slate) keep a little chroma; very saturated picks are tamed slightly.
  const chroma = Math.min(C, 0.2);
  return Object.fromEntries(SHADES.map((s, i) => [s, oklchToHex(LIGHTNESS[i], chroma * CHROMA[i], h)])) as Palette;
}

/** WCAG relative luminance and contrast ratio. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * CSS for :root. The app's existing "blue" utility classes (buttons, links, focus rings)
 * read Tailwind's --color-blue-* variables, so remapping those recolors the whole app.
 */
export function accentCss(hex: string): string {
  const p = paletteFor(hex);
  const vars = SHADES.map((s) => `--color-blue-${s}:${p[s]};--accent-${s}:${p[s]};`).join("");
  return `:root{${vars}--accent-picked:${normalizeHex(hex) ?? DEFAULT_ACCENT};}`;
}
