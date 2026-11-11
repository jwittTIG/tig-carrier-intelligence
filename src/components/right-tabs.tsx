"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { carrierContactsAction, type ContactCard } from "@/app/(app)/dashboard/actions";

type Portal = { id: string; name: string; portalUrl: string; logoUrl: string | null };
type Carrier = { id: string; name: string };
type Panel = "portals" | "contacts";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const TABS: { key: Panel; label: string; top: string }[] = [
  { key: "portals", label: "Carrier portals", top: "top-[22%]" },
  { key: "contacts", label: "Carrier contacts", top: "top-[52%]" },
];

/**
 * Tabs on the right edge of the Dashboard. Each slides out a panel: carrier portal sign-ins
 * (logos), or a carrier's contacts. One panel is open at a time. Panels stay in the page while
 * closed (inert, off-screen) so logos load right away.
 */
export function RightTabs({ portals, carriers }: { portals: Portal[] | null; carriers: Carrier[] | null }) {
  const [open, setOpen] = useState<Panel | null>(null);
  const tabRefs = useRef<Record<Panel, HTMLButtonElement | null>>({ portals: null, contacts: null });
  const panels = useRef<Record<Panel, HTMLElement | null>>({ portals: null, contacts: null });
  const available = TABS.filter((t) => (t.key === "portals" ? portals : carriers));

  const close = () => {
    const was = open;
    setOpen(null);
    if (was) tabRefs.current[was]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panels.current[open]?.querySelector<HTMLElement>("select, a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when a panel opens or closes
  }, [open]);

  return (
    <>
      {available.map((t) => (
        <button
          key={t.key}
          ref={(el) => { tabRefs.current[t.key] = el; }}
          type="button"
          onClick={() => setOpen((o) => (o === t.key ? null : t.key))}
          aria-expanded={open === t.key}
          aria-controls={`drawer-${t.key}`}
          className={`fixed right-0 ${t.top} z-30 flex items-center gap-2 rounded-l-xl px-2 py-4 text-sm font-semibold text-white shadow-lg transition-transform [writing-mode:vertical-rl] ${open === t.key ? "-translate-x-80 bg-blue-800" : "bg-blue-700 hover:bg-blue-800"} ${open && open !== t.key ? "-translate-x-80" : ""}`}
        >
          <span aria-hidden="true">{open === t.key ? "›" : "‹"}</span>
          {t.label}
        </button>
      ))}

      {portals && (
        <Drawer id="portals" title="Carrier portals" open={open === "portals"} onClose={close} panelRef={(el) => { panels.current.portals = el; }}>
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
        </Drawer>
      )}

      {carriers && (
        <Drawer id="contacts" title="Carrier contacts" open={open === "contacts"} onClose={close} panelRef={(el) => { panels.current.contacts = el; }}>
          <ContactsPanel carriers={carriers} />
        </Drawer>
      )}
    </>
  );
}

function Drawer({ id, title, open, onClose, panelRef, children }: { id: Panel; title: string; open: boolean; onClose: () => void; panelRef: (el: HTMLElement | null) => void; children: React.ReactNode }) {
  return (
    <aside
      id={`drawer-${id}`}
      ref={panelRef}
      aria-label={title}
      inert={!open}
      className={`fixed right-0 top-0 z-30 flex h-full w-80 flex-col gap-3 border-l border-zinc-200 bg-white p-4 shadow-2xl transition-transform duration-200 dark:border-zinc-700 dark:bg-zinc-900 ${open ? "translate-x-0" : "translate-x-full"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-blue-800 dark:text-blue-200">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
          Close<span className="sr-only"> {title.toLowerCase()}</span>
        </button>
      </div>
      {children}
    </aside>
  );
}

function ContactsPanel({ carriers }: { carriers: Carrier[] }) {
  const id = useId();
  const [carrierId, setCarrierId] = useState("");
  const [result, setResult] = useState<{ ok: true; contacts: ContactCard[] } | { ok: false; error: string } | null>(null);
  const [pending, start] = useTransition();

  const pick = (value: string) => {
    setCarrierId(value);
    setResult(null);
    if (value) start(async () => setResult(await carrierContactsAction(value)));
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">Carrier</label>
        <select id={id} value={carrierId} onChange={(e) => pick(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800">
          <option value="">Choose a carrier…</option>
          {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div aria-live="polite" aria-busy={pending} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-4">
        {pending && <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading contacts…</p>}
        {result && !result.ok && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{result.error}</p>}
        {result?.ok && result.contacts.length === 0 && (
          <p className="text-sm">
            No contacts at this carrier yet. <Link href={`/carriers/${carrierId}?tab=contacts`} className="text-blue-800 hover:underline dark:text-blue-300">Add one</Link>
          </p>
        )}
        {result?.ok && result.contacts.length > 0 && (
          <>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{result.contacts.length} {result.contacts.length === 1 ? "contact" : "contacts"}</p>
            <ul className="flex flex-col gap-2">
              {result.contacts.map((c) => (
                <li key={c.assignmentId} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-700">
                  <Link href={`/contacts/${c.contactId}`} className="font-medium text-blue-800 hover:underline dark:text-blue-300">{c.name}</Link>
                  {c.inactive && <span className="text-zinc-600 dark:text-zinc-400"> (inactive)</span>}
                  <div className="text-xs font-medium">{c.type}{c.title && ` · ${c.title}`}</div>
                  {(c.territory || c.lines.length > 0) && <div className="text-xs text-zinc-600 dark:text-zinc-400">{[c.territory, c.lines.join(", ")].filter(Boolean).join(" · ")}</div>}
                  <div className="mt-1 flex flex-col gap-0.5 text-xs">
                    {c.email && <a href={`mailto:${c.email}`} className="break-all text-blue-800 hover:underline dark:text-blue-300">{c.email}</a>}
                    {c.officePhone && <a href={`tel:${c.officePhone}`} className="text-blue-800 hover:underline dark:text-blue-300">Office {c.officePhone}</a>}
                    {c.mobilePhone && <a href={`tel:${c.mobilePhone}`} className="text-blue-800 hover:underline dark:text-blue-300">Mobile {c.mobilePhone}</a>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {carrierId && <Link href={`/carriers/${carrierId}?tab=contacts`} className="text-xs text-blue-800 hover:underline dark:text-blue-300">Open the carrier&apos;s Contacts tab</Link>}
    </>
  );
}
