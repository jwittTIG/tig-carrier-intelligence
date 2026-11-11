"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { carrierContactsAction, type ContactCard } from "@/app/(app)/dashboard/actions";

type Portal = { id: string; name: string; portalUrl: string; logoUrl: string | null };
type Carrier = { id: string; name: string };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/**
 * The Dashboard's right-hand column: stacked menus that open downward when clicked
 * (Josh, 2026-11-11). Carrier portals and Carrier contacts for now. Each opens on its own.
 */
export function RightMenus({ portals, carriers }: { portals: Portal[] | null; carriers: Carrier[] | null }) {
  return (
    <div className="flex flex-col gap-3">
      {portals && (
        <Menu title="Carrier portals" count={portals.length}>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Opens the carrier&apos;s sign-in page in a new tab. Use the password manager to log in.</p>
          {portals.length === 0 ? (
            <p className="text-sm">No portal sites saved yet. Add one on a carrier&apos;s Overview (Edit details → Carrier portal site).</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {portals.map((p) => (
                <li key={p.id}>
                  <a
                    href={p.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-full flex-col items-center gap-2 rounded-xl border border-zinc-200 p-2 text-center text-sm font-medium hover:border-blue-600 hover:bg-blue-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {p.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a short-lived private link, not a static asset
                      <img src={p.logoUrl} alt="" className="h-12 w-12 rounded-lg bg-white object-contain p-1" />
                    ) : (
                      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 text-base font-bold text-blue-800 dark:bg-blue-900 dark:text-blue-100">{initials(p.name)}</span>
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
        </Menu>
      )}
      {carriers && (
        <Menu title="Carrier contacts">
          <ContactsPanel carriers={carriers} />
        </Menu>
      )}
    </div>
  );
}

/** A heading button that opens its content below it. The content stays in the page (hidden) so logos load right away. */
function Menu({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left text-base font-semibold text-blue-800 hover:bg-blue-50 dark:text-blue-200 dark:hover:bg-zinc-800"
        >
          <span>
            {title}
            {count !== undefined && <span className="ml-2 text-sm font-normal text-zinc-600 dark:text-zinc-400">({count})</span>}
          </span>
          <span aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </button>
      </h2>
      <div id={id} hidden={!open} className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
        {children}
      </div>
    </section>
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
      <div aria-live="polite" aria-busy={pending} className="flex flex-col gap-2">
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
