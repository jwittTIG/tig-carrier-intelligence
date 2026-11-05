import { z } from "zod";
import { ValidationError } from "@/server/errors";

/** Optional trimmed text: blank → undefined. */
export const optionalText = (max = 500) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v), z.string().max(max).optional());

export const requiredText = (max = 200) => z.string().trim().min(1, "Required").max(max);

/** Optional UUID: blank → undefined; explicit null kept (used to clear a field). */
export const optionalId = z.preprocess((v) => (v === "" ? undefined : v), z.uuid().nullable().optional());

/** "YYYY-MM-DD" → Date at UTC midnight. Blank → undefined. */
export const optionalDate = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  z.iso.date().transform((s) => new Date(`${s}T00:00:00.000Z`)).nullable().optional(),
);

export const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.url({ protocol: /^https?$/ }).max(500).nullable().optional(),
);

/** Parses `input` or throws a ValidationError listing each issue. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  throw new ValidationError(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; "), issues);
}

/** FormData → plain object (last value wins; checkboxes are "on"). */
export function formObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
