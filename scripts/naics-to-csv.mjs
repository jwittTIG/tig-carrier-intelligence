/**
 * Builds prisma/data/naics-2022.csv from the U.S. Census Bureau's NAICS code list.
 * Source (downloaded 2026-11-06 with Josh's OK): https://www.census.gov/naics/2022NAICS/2-6%20digit_2022_Codes.xlsx
 * Usage: unzip the .xlsx into a folder (it is a zip file), then
 *   node scripts/naics-to-csv.mjs <unzipped folder> prisma/data/naics-2022.csv
 * Reads xl/sharedStrings.xml and xl/worksheets/sheet1.xml (columns B = code, C = title).
 */
import fs from "node:fs";
import path from "node:path";
const [dir, out] = process.argv.slice(2);
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const ss = fs.readFileSync(path.join(dir, "xl/sharedStrings.xml"), "utf8");
const strings = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
const sheet = fs.readFileSync(path.join(dir, "xl/worksheets/sheet1.xml"), "utf8");
const rows = [];
for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
  const cells = {};
  for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, col, attrs, inner = ""] = c;
    const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    const isT = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
    cells[col] = / t="s"/.test(attrs) && v !== undefined ? strings[+v] : isT !== undefined ? decode(isT) : v !== undefined ? decode(v) : "";
  }
  rows.push(cells);
}
console.log("header rows:", JSON.stringify(rows.slice(0, 3)));
const out_ = [];
const seen = new Set();
for (const r of rows) {
  const code = String(r.B ?? "").trim();
  const title = String(r.C ?? "").trim();
  if (!/^\d{2}(-\d{2})?\d{0,4}$/.test(code) || !title) continue;
  if (seen.has(code)) continue;
  seen.add(code);
  out_.push([code, title]);
}
const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
fs.writeFileSync(out, "code,title\n" + out_.map((r) => r.map(esc).join(",")).join("\n") + "\n");
console.log("codes:", out_.length, "by length:", JSON.stringify(out_.reduce((a, [c]) => ((a[c.length] = (a[c.length] ?? 0) + 1), a), {})));
console.log("sample:", JSON.stringify(out_.filter(([c]) => ["238160", "2381", "524126", "31-33"].includes(c))));
