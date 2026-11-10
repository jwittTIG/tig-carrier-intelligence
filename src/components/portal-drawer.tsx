"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Portal = { id: string; name: string; portalUrl: string; logoUrl: string | null };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/**
 * A tab on the right edge of the Dashboard that slides out a panel of carrier logos, each
 * opening that carrier's portal sign-in in a new tab. Logins stay in the password manager.
 * The panel stays in the page while closed (inert and off-screen) so logos load right away.
 */
export function PortalDrawer({ portals }: { portals: Portal[] }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const tab = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        tab.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={tab}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="portal-drawer"
        className={`fixed right-0 top-1/3 z-30 flex items-center gap-2 rounded-l-xl bg-blue-700 px-2 py-4 text-sm font-semibold text-white shadow-lg transition-transform hover:bg-blue-800 [writing-mode:vertical-rl] ${open ? "-translate-x-80" : ""}`}
      >
        <span aria-hidden="true">{open ? "›" : "‹"}</span>
        Carrier portals
      </button>

      <aside
        id="portal-drawer"
        ref={panel}
        aria-label="Carrier portals"
        inert={!open}
        className={`fixed right-0 top-0 z-30 flex h-full w-80 flex-col gap-3 border-l border-zinc-200 bg-white p-4 shadow-2xl transition-transform duration-200 dark:border-zinc-700 dark:bg-zinc-900 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-blue-800 dark:text-blue-200">Carrier portals</h2>
          <button type="button" onClick={() => { setOpen(false); tab.current?.focus(); }} className="rounded-lg px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Close<span className="sr-only"> carrier portals</span>
          </button>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Opens the carrier&apos;s sign-in page in a new tab. Use the password manager to log in.</p>
        {portals.length === 0 ? (
          <p className="text-sm">No portal sites saved yet. Add one on a carrier&apos;s Overview (Edit details → Carrier portal site).</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 overflow-y-auto pb-4">
            {portals.map((p) => (
              <li key={p.id}>
                <a
                  href={p.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-full flex-col items-center gap-2 rounded-xl border border-zinc-200 p-3 text-center text-sm font-medium hover:border-blue-600 hover:bg-blue-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {p.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a short-lived private link, not a static asset
                    <img src={p.logoUrl} alt="" className="h-14 w-14 rounded-lg bg-white object-contain p-1" />
                  ) : (
                    <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-lg bg-blue-100 text-lg font-bold text-blue-800 dark:bg-blue-900 dark:text-blue-100">{initials(p.name)}</span>
                  )}
                  <span>
                    {p.name}
                    <span className="sr-only"> portal (opens in a new tab)</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <Link href="/carriers" className="mt-auto text-xs text-blue-800 hover:underline dark:text-blue-300">All carriers</Link>
      </aside>
    </>
  );
}
