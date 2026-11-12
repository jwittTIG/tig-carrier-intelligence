import Link from "next/link";
import { contactRoleLabel, isDialable } from "@/lib/contact-roles";
import type { mainContacts } from "@/server/services/contacts";
import { Icon } from "./icons";

type Data = Awaited<ReturnType<typeof mainContacts>>;

/**
 * "Main contacts" (Josh, 2026-11-12): a carrier's marketing rep, claims and billing contacts at a
 * glance. Every row shows, even when nothing is on file. Three columns on wide screens, stacked
 * on phones.
 */
export function MainContactsCard({ data, addHref, showCarrier }: { data: Data; addHref?: string; showCarrier?: boolean }) {
  return (
    <section aria-labelledby={`main-contacts-${data.carrier.id}`} className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`main-contacts-${data.carrier.id}`} className="text-[17px] font-semibold leading-6 tracking-[-0.01em] text-blue-700 dark:text-zinc-100">
          Main contacts{showCarrier && <span className="font-normal text-zinc-600 dark:text-zinc-400">: {data.carrier.name}</span>}
        </h2>
        {showCarrier && <Link href={`/carriers/${data.carrier.id}?tab=contacts`} className="text-xs text-zinc-600 dark:text-zinc-400">All of {data.carrier.name}&apos;s contacts</Link>}
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {data.groups.map((g) => (
          <li key={g.key} className="flex flex-col gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
            <h3 className="text-xs font-semibold tracking-wide text-zinc-600 dark:text-zinc-400">{g.label}</h3>
            {g.contacts.length === 0 ? (
              <p className="flex flex-col gap-1 text-[13px] text-zinc-700 dark:text-zinc-300">
                <span>{g.empty}</span>
                {addHref && <Link href={addHref} className="w-fit text-xs text-blue-700 dark:text-blue-300">Add one</Link>}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {g.contacts.map((c) => (
                  <li key={c.assignmentId} className="flex flex-col gap-0.5 text-[13px]">
                    <Link href={`/contacts/${c.contactId}`} className="w-fit font-semibold text-zinc-900 dark:text-zinc-100">{c.name}</Link>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      {g.key === "marketing" ? null : contactRoleLabel(c.role)}
                      {g.key !== "marketing" && (c.title || c.territory) ? " · " : ""}
                      {[c.title, c.territory].filter(Boolean).join(" · ")}
                    </span>
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="inline-flex min-h-6 w-fit items-center gap-1.5 break-all text-blue-700 dark:text-blue-300">
                        <Icon name="mail" className="h-3.5 w-3.5 shrink-0 text-zinc-500" />{c.email}
                      </a>
                    )}
                    {c.officePhone && (
                      <a href={`tel:${c.officePhone}`} className="inline-flex min-h-6 w-fit items-center gap-1.5 text-blue-700 dark:text-blue-300">
                        <Icon name="phone" className="h-3.5 w-3.5 shrink-0 text-zinc-500" />{c.officePhone}<span className="sr-only"> (office)</span>
                      </a>
                    )}
                    {c.mobilePhone && (
                      <a href={`tel:${c.mobilePhone}`} className="inline-flex min-h-6 w-fit items-center gap-1.5 text-blue-700 dark:text-blue-300">
                        <Icon name="phone" className="h-3.5 w-3.5 shrink-0 text-zinc-500" />{c.mobilePhone}<span className="text-xs text-zinc-600 dark:text-zinc-400">mobile</span>
                      </a>
                    )}
                    {!c.email && !c.officePhone && !c.mobilePhone && <span className="text-xs text-zinc-600 dark:text-zinc-400">No email or phone on file</span>}
                  </li>
                ))}
              </ul>
            )}
            {g.line && (
              <p className="mt-auto border-t border-zinc-200 pt-2 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                Carrier {g.key} line:{" "}
                {isDialable(g.line) ? <a href={`tel:${g.line}`} className="inline-flex min-h-6 items-center font-medium text-blue-700 dark:text-blue-300">{g.line}</a> : <span className="font-medium text-zinc-800 dark:text-zinc-200">{g.line}</span>}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
