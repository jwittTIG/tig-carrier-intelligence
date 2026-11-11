"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { carrierSnapshotAction, type Snapshot } from "@/app/(app)/dashboard/snapshot-action";

const CODE_TYPE: Record<string, string> = { MASTER: "Master", PRODUCER: "Producer", SUB_CODE: "Sub-code", LOCATION: "Location", OTHER: "Other" };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Dashboard: pick a carrier, see its main, billing and claims numbers, marketing rep and agency codes. */
export function CarrierSnapshot({ carriers }: { carriers: { id: string; name: string }[] }) {
  const id = useId();
  const [carrierId, setCarrierId] = useState("");
  const [result, setResult] = useState<{ ok: true; snapshot: Snapshot } | { ok: false; error: string } | null>(null);
  const [pending, start] = useTransition();

  const pick = (value: string) => {
    setCarrierId(value);
    setResult(null);
    if (value) start(async () => setResult(await carrierSnapshotAction(value)));
  };
  const s = result?.ok ? result.snapshot : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 sm:max-w-sm">
        <label htmlFor={id} className="text-sm">Carrier</label>
        <select id={id} value={carrierId} onChange={(e) => pick(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800">
          <option value="">Choose a carrier…</option>
          {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div aria-live="polite" aria-busy={pending}>
        {pending && <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>}
        {result && !result.ok && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{result.error}</p>}
        {s && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {s.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a short-lived private link, not a static asset
                <img src={s.logoUrl} alt="" className="h-10 w-10 rounded-lg border border-zinc-200 bg-white object-contain p-0.5 dark:border-zinc-700" />
              ) : (
                <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-sm font-bold text-blue-800 dark:bg-blue-900 dark:text-blue-100">{initials(s.name)}</span>
              )}
              <Link href={`/carriers/${s.id}`} className="inline-flex min-h-6 items-center text-lg font-semibold text-blue-800 hover:underline dark:text-blue-300">{s.name}</Link>
              {s.portalUrl && (
                <a href={s.portalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center rounded-lg bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800">
                  Portal <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </div>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <Item label="Main phone"><Phone value={s.phones.main} carrierId={s.id} /></Item>
              <Item label="Billing phone"><Phone value={s.phones.billing} carrierId={s.id} /></Item>
              <Item label="Claims phone"><Phone value={s.phones.claims} carrierId={s.id} /></Item>
              <Item label="Marketing rep">
                {s.reps === null ? (
                  <span className="text-zinc-600 dark:text-zinc-400">No access to contacts</span>
                ) : s.reps.length === 0 ? (
                  <NotRecorded href={`/carriers/${s.id}?tab=contacts`} />
                ) : (
                  <ul className="flex flex-col gap-1">
                    {s.reps.map((r) => (
                      <li key={r.contactId} className="flex flex-col">
                        <Link href={`/contacts/${r.contactId}`} className="inline-flex min-h-6 items-center font-medium hover:underline">{r.name}</Link>
                        {r.email && <a href={`mailto:${r.email}`} className="inline-flex min-h-6 items-center break-all text-blue-800 hover:underline dark:text-blue-300">{r.email}</a>}
                        {r.phone && <a href={`tel:${r.phone}`} className="inline-flex min-h-6 items-center text-blue-800 hover:underline dark:text-blue-300">{r.phone}</a>}
                      </li>
                    ))}
                  </ul>
                )}
              </Item>
            </dl>
            <div className="text-sm">
              <h3 className="text-xs font-medium uppercase text-zinc-600 dark:text-zinc-400">Agency code</h3>
              {s.codes === null ? (
                <p className="text-zinc-600 dark:text-zinc-400">No access to codes</p>
              ) : s.codes.length === 0 ? (
                <NotRecorded href={`/carriers/${s.id}?tab=codes`} />
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {s.codes.map((c) => (
                    <li key={`${c.type}-${c.value}-${c.producer}`}>
                      <span className="font-mono text-base font-semibold">{c.value}</span>{" "}
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {CODE_TYPE[c.type] ?? c.type}
                        {c.producer && ` · ${c.producer}`} · {c.lines.length > 3 ? `${c.lines.length} lines` : c.lines.join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
      <dt className="text-xs font-medium uppercase text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Phone({ value, carrierId }: { value: string | null; carrierId: string }) {
  return value ? <a href={`tel:${value}`} className="inline-flex min-h-6 items-center text-base font-medium text-blue-800 hover:underline dark:text-blue-300">{value}</a> : <NotRecorded href={`/carriers/${carrierId}?edit=1`} />;
}

function NotRecorded({ href }: { href: string }) {
  return (
    <span className="text-zinc-600 dark:text-zinc-400">
      Not recorded · <Link href={href} className="inline-flex min-h-6 items-center text-blue-800 hover:underline dark:text-blue-300">add it</Link>
    </span>
  );
}
