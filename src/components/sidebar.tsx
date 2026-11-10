"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { setAccentAction, setModeAction } from "@/app/theme-actions";
import { ACCENT_PRESETS, type Mode } from "@/lib/theme";
import { Icon } from "./icons";

export type NavItem = { href: string; label: string; icon: string; badge?: number; /** Other paths that highlight this item. */ match?: string[] };

/** Sidebar menu with the current page highlighted. */
export function SidebarNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const under = (p: string) => path === p || path.startsWith(`${p}/`);
  const items_ = items.map((i) => ({ ...i, on: [i.href, ...(i.match ?? [])].some(under) }));
  return (
    <ul className="flex flex-col gap-0.5">
      {items_.map((i) => (
        <li key={i.href}>
          <Link
            href={i.href}
            aria-current={i.on ? "page" : undefined}
            aria-label={i.badge ? `${i.label}, ${i.badge} unread` : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${i.on ? "bg-white text-blue-800 shadow-sm dark:bg-blue-950 dark:text-blue-100" : "text-white hover:bg-blue-700"}`}
          >
            <Icon name={i.icon} />
            <span className="flex-1">{i.label}</span>
            {!!i.badge && (
              <span className={`rounded-full px-1.5 text-xs font-semibold ${i.on ? "bg-blue-700 text-white" : "bg-white text-blue-800"}`}>
                {i.badge}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Pick the app's main color: presets or any custom color. Saved in this browser. */
export function AccentPicker({ current, mode }: { current: string; mode: Mode }) {
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState(current);
  const id = useId();
  const pick = (hex: string) => start(async () => { await setAccentAction(hex); });
  return (
    <details className="group rounded-xl bg-blue-700 px-3 py-2 text-sm text-white dark:bg-blue-800">
      <summary className="flex cursor-pointer list-none items-center gap-3 font-medium">
        <Icon name="palette" />
        <span className="flex-1">Color</span>
        <span className="h-4 w-4 rounded-full border-2 border-white" style={{ background: current }} aria-hidden="true" />
      </summary>
      <div className="mt-3 flex flex-col gap-3" aria-busy={pending}>
        <div role="group" aria-label="Background" className="grid grid-cols-2 gap-1 rounded-lg bg-white/15 p-1">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => start(async () => { await setModeAction(m); })}
              disabled={pending}
              aria-pressed={mode === m}
              className={`rounded-md px-2 py-1 text-xs font-semibold ${mode === m ? "bg-white text-blue-800" : "text-white hover:bg-white/10"}`}
            >
              {m === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Preset colors" className="grid grid-cols-4 gap-2">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.hex}
              type="button"
              onClick={() => pick(p.hex)}
              disabled={pending}
              aria-pressed={current === p.hex}
              title={p.name}
              className={`h-8 w-8 rounded-full border-2 ${current === p.hex ? "border-white ring-2 ring-white/60" : "border-white/40"}`}
              style={{ background: p.hex }}
            >
              <span className="sr-only">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input id={id} type="color" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0" />
          <label htmlFor={id}>Custom</label>
          <button type="button" onClick={() => pick(custom)} disabled={pending || custom === current} className="ml-auto rounded-lg bg-white px-2 py-1 text-xs font-semibold text-blue-800 disabled:opacity-60">
            {pending ? "Saving…" : "Use"}
          </button>
        </div>
        <p className="text-xs text-white">Shades are adjusted so text stays readable. Saved in this browser only.</p>
      </div>
    </details>
  );
}
