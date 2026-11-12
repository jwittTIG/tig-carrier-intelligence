"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { carrierContactsAction, type ContactCard } from "@/app/(app)/dashboard/actions";
import { Icon } from "./icons";
import { inputClass } from "./ui";

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
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Click a logo to open that carrier&apos;s sign-in page in a new tab. Use the password manager to log in.</p>
          {portals.length === 0 ? (
            <p className="text-sm">No portal sites saved yet. Add one on a carrier&apos;s Overview (Edit details → Carrier portal site).</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5">
              {portals.map((p) => (
                <li key={p.id}>
                  {/* The logo is the button (Josh, 2026-11-12); the name stays, small, so look-alike logos can't be mixed up. */}
                  <a
                    href={p.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs hover:-translate-y-px hover:border-orange-400 hover:shadow-md focus-visible:border-orange-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-orange-500"
                  >
                    {p.logoUrl ? (
                      // Always a white tile, in dark mode too, so transparent and dark logos stay legible.
                      <span className="flex h-20 items-center justify-center bg-white px-3 py-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived private link, not a static asset */}
                        <img src={p.logoUrl} alt="" className="max-h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]" />
                      </span>
                    ) : (
                      <span aria-hidden="true" data-monogram className="flex h-20 items-center justify-center bg-blue-700 text-2xl font-semibold tracking-tight text-white dark:bg-zinc-800">
                        {initials(p.name)}
                      </span>
                    )}
                    <span className="flex items-center justify-between gap-1.5 border-t border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium leading-4 text-zinc-600 group-hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:group-hover:text-white">
                      <span className="truncate" title={p.name}>
                        {p.name}
                        <span className="sr-only"> portal (opens in a new tab)</span>
                      </span>
                      <Icon name="external" className="h-3 w-3 shrink-0" />
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
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[15px] font-semibold text-blue-700 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          <span>
            {title}
            {count !== undefined && <span className="ml-2 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{count}</span>}
          </span>
          <Icon name="chevron" className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </h2>
      <div id={id} hidden={!open} className="flex flex-col gap-3 border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
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
        <select id={id} value={carrierId} onChange={(e) => pick(e.target.value)} className={inputClass}>
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
                <li key={c.assignmentId} className="rounded-xl border border-zinc-200 p-3 text-[13px] dark:border-zinc-700">
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
