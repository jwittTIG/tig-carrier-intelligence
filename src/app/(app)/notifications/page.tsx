import Link from "next/link";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/session";
import { listFollowing, listNotifications } from "@/server/services/notifications";
import { ActionForm } from "@/components/action-form";
import { Section, fmtDateTime } from "@/components/ui";
import { markAllReadAction, markReadAction, runRemindersAction } from "./actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const ctx = await requireAuth();
  const unreadOnly = (await searchParams).show === "unread";
  const [items, following] = await Promise.all([listNotifications(ctx, { unreadOnly }), listFollowing(ctx)]);
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <>
      <h1 className="page-title">Notifications</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Shown here only; nothing is emailed. You get notifications for carriers you follow (use Follow on a carrier page), and when your own submissions are decided.
      </p>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <nav aria-label="Filter notifications" className="flex gap-3">
          <Link href="/notifications" aria-current={!unreadOnly ? "page" : undefined} className={!unreadOnly ? "font-semibold" : "hover:underline"}>All</Link>
          <Link href="/notifications?show=unread" aria-current={unreadOnly ? "page" : undefined} className={unreadOnly ? "font-semibold" : "hover:underline"}>Unread</Link>
        </nav>
        {unread > 0 && <ActionForm action={markAllReadAction} submitLabel="Mark all read" variant="secondary" className="flex items-center gap-2">{null}</ActionForm>}
        {can(ctx, "admin.settings") && (
          <ActionForm action={runRemindersAction} submitLabel="Check reminders now" variant="secondary" className="flex items-center gap-2">{null}</ActionForm>
        )}
      </div>

      <Section title={unreadOnly ? `Unread (${items.length})` : `Recent (${items.length})`}>
        {items.length === 0 ? (
          <p className="text-sm">{unreadOnly ? "Nothing unread." : "No notifications yet."}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((n) => (
              <li key={n.id} className={`flex flex-wrap items-start justify-between gap-2 rounded-xl border p-3 text-sm ${n.readAt ? "border-zinc-200 dark:border-zinc-700" : "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950"}`}>
                <div className="flex min-w-0 flex-col gap-1">
                  <span>
                    {!n.readAt && <span className="sr-only">Unread: </span>}
                    {n.href ? <Link href={n.href} className="font-medium hover:underline">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
                  </span>
                  {n.body && <span className="text-zinc-700 dark:text-zinc-300">“{n.body}”</span>}
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">{fmtDateTime(n.createdAt)}{n.organization && <> · <Link href={`/carriers/${n.organization.id}`} className="hover:underline">{n.organization.displayName}</Link></>}</span>
                </div>
                {!n.readAt && <ActionForm action={markReadAction.bind(null, n.id)} submitLabel="Mark read" variant="secondary" showOk={false} className="flex items-center gap-2">{null}</ActionForm>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Carriers you follow (${following.length})`}>
        {following.length === 0 ? (
          <p className="text-sm">None yet. Open a carrier and choose Follow.</p>
        ) : (
          <ul className="flex flex-wrap gap-3 text-sm">
            {following.map((f) => <li key={f.organizationId}><Link href={`/carriers/${f.organizationId}`} className="hover:underline">{f.organization.displayName}</Link></li>)}
          </ul>
        )}
      </Section>
    </>
  );
}
