"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { carrierContactsAction, type ContactCard } from "@/app/(app)/dashboard/actions";
import { Icon } from "./icons";
import { inputClass } from "./ui";

type Portal = { id: string; name: string; portalUrl: string; logoUrl: string | null };
type Carrier = { id: string; name: string };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

// Text on the navy boxes: white headings, light gray body, light orange links (all pass WCAG AA on navy).
const LINK = "text-orange-300 hover:text-orange-200";
const MUTED = "text-zinc-300";

/**
 * The Dashboard's right-hand column: stacked menus that open downward when clicked
 * (Josh, 2026-11-11). Carrier portals and Carrier contacts, on TIG navy so they stand out from
 * the white cards (Josh, 2026-11-12). Each opens on its own.
 */
export function RightMenus({ portals, carriers }: { portals: Portal[] | null; carriers: Carrier[] | null }) {
  return (
    <div className="flex flex-col gap-3">
      {portals && (
        <Menu title="Carrier portals" count={portals.length}>
          <p className={`text-xs ${MUTED}`}>Click a logo to open that carrier&apos;s sign-in page in a new tab. Use the password manager to log in.</p>
          {portals.length === 0 ? (
            <p className="text-sm text-zinc-200">No portal sites saved yet. Add one on a carrier&apos;s Overview (Edit details → Carrier portal site).</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5">
              {portals.map((p) => (
                <li key={p.id}>
                  {/* The logo is the button (Josh, 2026-11-12); the name stays, small, so look-alike logos can't be mixed up. */}
                  <a
                    href={p.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex h-full flex-col overflow-hidden rounded-xl border border-white/15 bg-white/5 hover:-translate-y-px hover:border-orange-400 hover:shadow-lg focus-visible:border-orange-400"
                  >
                    {p.logoUrl ? (
                      // Always a white tile so transparent and dark logos stay legible.
                      <span className="flex h-20 items-center justify-center bg-white px-3 py-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived private link, not a static asset */}
                        <img src={p.logoUrl} alt="" className="max-h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]" />
                      </span>
                    ) : (
                      <span aria-hidden="true" data-monogram className="flex h-20 items-center justify-center bg-white/10 text-2xl font-semibold tracking-tight text-white">
                        {initials(p.name)}
                      </span>
                    )}
                    <span className="flex items-center justify-between gap-1.5 border-t border-white/10 px-2.5 py-1.5 text-[11px] font-medium leading-4 text-zinc-200 group-hover:text-white">
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

/**
 * A navy box whose heading opens its content below it. The content stays in the page (hidden)
 * so logos load right away. Dark mode: a brighter navy and a light outline against the dark page.
 */
function Menu({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="on-navy overflow-hidden rounded-2xl bg-blue-700 text-zinc-100 shadow-md ring-1 ring-blue-900/40 dark:bg-[#1d3a63] dark:ring-white/15">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[15px] font-semibold text-white hover:bg-white/5"
        >
          <span className="flex items-center">
            {title}
            {count !== undefined && <span className="ml-2 rounded-md bg-white/15 px-1.5 py-0.5 text-xs font-medium text-white">{count}</span>}
          </span>
          <Icon name="chevron" className={`h-4 w-4 text-zinc-300 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </h2>
      <div id={id} hidden={!open} className="flex flex-col gap-3 border-t border-white/10 px-4 py-4">
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[13px] font-medium text-white">Carrier</label>
        <select id={id} value={carrierId} onChange={(e) => pick(e.target.value)} className={inputClass}>
          <option value="">Choose a carrier…</option>
          {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div aria-live="polite" aria-busy={pending} className="flex flex-col gap-2">
        {pending && <p className={`text-sm ${MUTED}`}>Loading contacts…</p>}
        {result && !result.ok && <p role="alert" className="text-sm text-red-200">{result.error}</p>}
        {result?.ok && result.contacts.length === 0 && (
          <p className="text-sm text-zinc-200">
            No contacts at this carrier yet. <Link href={`/carriers/${carrierId}?tab=contacts`} className={LINK}>Add one</Link>
          </p>
        )}
        {result?.ok && result.contacts.length > 0 && (
          <>
            <p className={`text-xs ${MUTED}`}>{result.contacts.length} {result.contacts.length === 1 ? "contact" : "contacts"}</p>
            <ul className="flex flex-col gap-2">
              {result.contacts.map((c) => (
                <li key={c.assignmentId} className="rounded-xl border border-white/10 bg-white/5 p-3 text-[13px] text-zinc-100">
                  <Link href={`/contacts/${c.contactId}`} className="font-medium text-white hover:text-orange-200">{c.name}</Link>
                  {c.inactive && <span className={MUTED}> (inactive)</span>}
                  <div className="text-xs font-medium text-zinc-200">{c.type}{c.title && ` · ${c.title}`}</div>
                  {(c.territory || c.lines.length > 0) && <div className={`text-xs ${MUTED}`}>{[c.territory, c.lines.join(", ")].filter(Boolean).join(" · ")}</div>}
                  <div className="mt-1 flex flex-col gap-0.5 text-xs">
                    {c.email && <a href={`mailto:${c.email}`} className={`break-all ${LINK}`}>{c.email}</a>}
                    {c.officePhone && <a href={`tel:${c.officePhone}`} className={LINK}>Office {c.officePhone}</a>}
                    {c.mobilePhone && <a href={`tel:${c.mobilePhone}`} className={LINK}>Mobile {c.mobilePhone}</a>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {carrierId && <Link href={`/carriers/${carrierId}?tab=contacts`} className={`text-xs ${LINK}`}>Open the carrier&apos;s Contacts tab</Link>}
    </>
  );
}
