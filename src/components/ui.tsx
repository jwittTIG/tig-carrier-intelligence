import Link from "next/link";

/**
 * Shared presentational pieces (TIG design system, 2026-11-11). Server-component safe.
 * Colors come from the tokens in src/app/globals.css: zinc = neutrals, blue = TIG navy,
 * orange = TIG accent.
 */

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{label}</label>
      {children}
      {hint && <p className="text-xs leading-snug text-zinc-600 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

/** Text inputs, selects and textareas: 36px tall, hairline border, soft navy focus ring. */
export const inputClass =
  "w-full min-h-9 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-normal text-zinc-900 shadow-xs outline-none hover:border-zinc-300 focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/15 disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:focus:border-blue-500 dark:focus:ring-blue-500/25";

type Tone = "neutral" | "warn" | "good" | "bad" | "info" | "accent";

/** Status badges: soft fill, compact, with a small dot for at-a-glance scanning. */
export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  const tones: Record<Tone, [string, string]> = {
    neutral: ["bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700", "bg-zinc-400"],
    warn: ["bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900", "bg-amber-500"],
    good: ["bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900", "bg-emerald-500"],
    bad: ["bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900", "bg-red-500"],
    info: ["bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-900", "bg-blue-500"],
    accent: ["bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-900", "bg-orange-500"],
  };
  const [cls, dot] = tones[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

/** A content card: white surface, hairline border, 10px corners, header with optional actions. */
export function Section({ title, children, actions, id, description }: { title: string; children: React.ReactNode; actions?: React.ReactNode; id?: string; description?: string }) {
  return (
    <section id={id} className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[17px] font-semibold leading-6 tracking-[-0.01em] text-blue-700 dark:text-zinc-100">{title}</h2>
          {description && <p className="text-[13px] text-zinc-600 dark:text-zinc-400">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Page heading: title, optional one-line description, and actions on the right. */
export function PageHeader({ title, description, actions, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{description}</p>}
      {children}
    </div>
  );
}

/** Button styles, shared by links and forms. */
export const buttonClass = {
  primary: "bg-blue-700 text-white shadow-xs hover:bg-blue-800 active:translate-y-px",
  accent: "bg-orange-500 text-[#0b1c30] shadow-xs hover:bg-orange-400 active:translate-y-px",
  secondary: "border border-zinc-200 bg-white text-zinc-800 shadow-xs hover:bg-zinc-50 hover:border-zinc-300 active:translate-y-px dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
  danger: "border border-red-200 bg-white text-red-700 shadow-xs hover:bg-red-50 hover:border-red-300 active:translate-y-px dark:border-red-900 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40",
  ghost: "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
} as const;
export const buttonBase = "inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium disabled:pointer-events-none disabled:opacity-60";

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: keyof typeof buttonClass }) {
  return (
    <Link href={href} className={`${buttonBase} ${buttonClass[variant]}`}>
      {children}
    </Link>
  );
}

/** A small "label: value" list for profile metadata. */
export function MetaList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col gap-0.5 border-b border-zinc-100 pb-3 dark:border-zinc-800">
          <dt className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{i.label}</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function label(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function fmtDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export function fmtDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
