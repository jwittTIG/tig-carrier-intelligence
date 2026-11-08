import { cookies } from "next/headers";
import { SignOutButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import Link from "next/link";
import { can } from "@/server/auth/context";
import { authDriver, requireAuth } from "@/server/auth/session";
import { devSignOut } from "@/server/auth/dev";
import { unreadCount } from "@/server/services/notifications";
import { ACCENT_COOKIE, DEFAULT_ACCENT, normalizeHex } from "@/lib/theme";
import { Icon } from "@/components/icons";
import { AccentPicker, SidebarNav, type NavItem } from "@/components/sidebar";
import { SETUP_PATHS, setupItems } from "./setup/items";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireAuth();
  const dev = authDriver() === "dev";
  const unread = await unreadCount(ctx);
  const accent = normalizeHex((await cookies()).get(ACCENT_COOKIE)?.value) ?? DEFAULT_ACCENT;
  async function signOut() {
    "use server";
    await devSignOut();
    redirect("/sign-in");
  }

  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    ...(can(ctx, "appetite.read") ? [{ href: "/markets", label: "Market Finder", icon: "markets" }] : []),
    ...(can(ctx, "guides.ask") ? [{ href: "/ask", label: "Ask the guides", icon: "ask" }] : []),
    { href: "/carriers", label: "Carriers", icon: "carriers" },
    ...(can(ctx, "contact.read") ? [{ href: "/contacts", label: "Contacts", icon: "contacts" }] : []),
    ...(can(ctx, "document.read") ? [{ href: "/documents", label: "Documents", icon: "documents" }] : []),
    ...(can(ctx, "inbox.read") ? [{ href: "/inbox", label: "Inbox", icon: "inbox" }] : []),
    ...(can(ctx, "change_request.review") ? [{ href: "/approvals", label: "Approvals", icon: "approvals" }] : []),
    { href: "/notifications", label: "Notifications", icon: "bell", badge: unread },
    // Industry codes, Import, Users and Audit log live on Setup.
    ...(setupItems(ctx).length ? [{ href: "/setup", label: "Setup", icon: "setup", match: SETUP_PATHS }] : []),
  ];
  const initials = ctx.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const role = ctx.roles.includes("ADMIN") ? "Admin" : ctx.roles.includes("STAFF") ? "Staff" : "Limited";
  const signOutButton = (
    <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
      <Icon name="logout" />
      Sign out
    </button>
  );

  const sidebarBody = (
    <>
      <nav aria-label="Main">
        <SidebarNav items={items} />
      </nav>
      <div className="mt-auto flex flex-col gap-2 pt-4">
        <AccentPicker current={accent} />
        {dev ? <form action={signOut}>{signOutButton}</form> : <SignOutButton>{signOutButton}</SignOutButton>}
      </div>
    </>
  );

  return (
    <>
      {dev && (
        <div className="bg-amber-200 px-4 py-1 text-center text-xs text-amber-950">
          Development sign-in (AUTH_DRIVER=dev). Not for real data.
        </div>
      )}
      <div className="flex flex-1 flex-col gap-4 bg-zinc-100 p-3 lg:flex-row lg:p-4 dark:bg-zinc-950">
        <aside className="flex flex-col gap-4 rounded-3xl bg-blue-600 p-4 text-white shadow-md lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:w-64 lg:shrink-0 lg:overflow-y-auto dark:bg-blue-900">
          <Link href="/dashboard" className="text-base font-semibold tracking-tight text-white">TIG Carrier Intelligence</Link>
          <div className="flex items-center gap-3 lg:flex-col lg:gap-2 lg:py-2">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-white/40 bg-white text-lg font-semibold text-blue-800 lg:h-16 lg:w-16 lg:text-xl" aria-hidden="true">{initials}</span>
            <div className="flex flex-col lg:items-center">
              <span className="font-semibold">{ctx.name}</span>
              <span className="w-fit rounded-full bg-blue-800 px-2 text-xs font-medium">{role}</span>
            </div>
          </div>
          <form action="/search" method="get" role="search">
            <label htmlFor="globalSearch" className="sr-only">Search carriers, contacts, codes and documents</label>
            <input id="globalSearch" name="q" type="search" placeholder="Search…" className="w-full rounded-xl border-0 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-600 dark:bg-zinc-900 dark:text-zinc-100" />
          </form>
          {/* Phones and narrow windows: the menu folds away. */}
          <details className="lg:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl bg-blue-700 px-3 py-2 text-sm font-medium dark:bg-blue-800"><Icon name="menu" />Menu</summary>
            <div className="mt-2 flex flex-col">{sidebarBody}</div>
          </details>
          <div className="hidden flex-1 flex-col lg:flex">{sidebarBody}</div>
        </aside>
        <main className="flex w-full min-w-0 flex-1 flex-col gap-4 lg:py-2">{children}</main>
      </div>
    </>
  );
}
