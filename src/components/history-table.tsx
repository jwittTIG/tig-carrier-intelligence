import { fmtDateTime } from "./ui";

type Event = { id: string; occurredAt: Date; action: string; beforeState: unknown; afterState: unknown; actor: { name: string } | null };

const SKIP = new Set(["updatedAt", "createdAt", "id"]);

/** "field: old → new" for an update; empty for creates (the action says enough). */
export function changedFields(before: unknown, after: unknown): string {
  if (!before) return "";
  const b = before as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => !SKIP.has(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => `${k}: ${JSON.stringify(b[k] ?? null)} → ${JSON.stringify(a[k] ?? null)}`)
    .join("; ");
}

export function HistoryTable({ events }: { events: Event[] }) {
  if (events.length === 0) return <p className="text-sm text-zinc-500">No recorded changes.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-zinc-500">
          <tr><th scope="col" className="py-1 pr-3">When</th><th scope="col" className="py-1 pr-3">Who</th><th scope="col" className="py-1 pr-3">What</th><th scope="col" className="py-1">Changes</th></tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
              <td className="whitespace-nowrap py-1 pr-3">{fmtDateTime(e.occurredAt)}</td>
              <td className="py-1 pr-3">{e.actor?.name ?? "System"}</td>
              <td className="py-1 pr-3">{e.action}</td>
              <td className="break-all py-1 font-mono text-xs">{changedFields(e.beforeState, e.afterState)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
