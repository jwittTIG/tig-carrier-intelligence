import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { can } from "@/server/auth/context";
import { authDriver, requireAuth } from "@/server/auth/session";
import { devSignOut } from "@/server/auth/dev";
import { unreadCount } from "@/server/services/notifications";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireAuth();
  const dev = authDriver() === "dev";
  const unread = await unreadCount(ctx);
  async function signOut() {
    "use server";
    await devSignOut();
    redirect("/sign-in");
  }
  const signOutButton = <button className="hover:underline">Sign out</button>;
  return (
    <>
      {dev && (
        <div className="bg-amber-200 px-4 py-1 text-center text-xs text-amber-950">
          Development sign-in (AUTH_DRIVER=dev). Not for real data.
        </div>
      )}
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
          <Link href="/dashboard" className="font-semibold">TIG Carrier Intelligence</Link>
          <Link href="/dashboard" className="hover:underline">Dashboard</Link>
          {can(ctx, "appetite.read") && <Link href="/markets" className="hover:underline">Market Finder</Link>}
          {can(ctx, "appetite.read") && <Link href="/industries" className="hover:underline">Industries</Link>}
          <Link href="/carriers" className="hover:underline">Carriers</Link>
          {can(ctx, "contact.read") && <Link href="/contacts" className="hover:underline">Contacts</Link>}
          {can(ctx, "appointment.read") && <Link href="/codes" className="hover:underline">Codes</Link>}
          {can(ctx, "document.read") && <Link href="/documents" className="hover:underline">Documents</Link>}
          {can(ctx, "inbox.read") && <Link href="/inbox" className="hover:underline">Inbox</Link>}
          {can(ctx, "change_request.review") && <Link href="/approvals" className="hover:underline">Approvals</Link>}
          {can(ctx, "admin.users") && <Link href="/admin/users" className="hover:underline">Users</Link>}
          {can(ctx, "audit.read") && <Link href="/admin/audit" className="hover:underline">Audit log</Link>}
          {can(ctx, "import.run") && <Link href="/imports" className="hover:underline">Import</Link>}
          <form action="/search" method="get" role="search" className="ml-auto">
            <label htmlFor="globalSearch" className="sr-only">Search carriers, contacts, codes and documents</label>
            <input id="globalSearch" name="q" type="search" placeholder="Search…" className="w-40 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
          </form>
          <Link href="/notifications" className="hover:underline" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
            Notifications{unread > 0 && <span className="ml-1 rounded-full bg-blue-700 px-1.5 text-xs font-semibold text-white">{unread}</span>}
          </Link>
          <span className="text-zinc-600 dark:text-zinc-400">{ctx.name}</span>
          {dev ? <form action={signOut}>{signOutButton}</form> : <SignOutButton>{signOutButton}</SignOutButton>}
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">{children}</main>
    </>
  );
}
