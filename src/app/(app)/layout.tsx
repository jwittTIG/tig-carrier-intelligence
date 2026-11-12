import { cookies } from "next/headers";
import { SignOutButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { can } from "@/server/auth/context";
import { authDriver, requireAuth } from "@/server/auth/session";
import { devSignOut } from "@/server/auth/dev";
import { unreadCount } from "@/server/services/notifications";
import { MODE_COOKIE, SIDEBAR_COOKIE, modeOf } from "@/lib/theme";
import { Icon } from "@/components/icons";
import { AppShell, type NavGroup, type NavItem } from "@/components/app-shell";
import { SETUP_PATHS, setupItems } from "./setup/items";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireAuth();
  const dev = authDriver() === "dev";
  const unread = await unreadCount(ctx);
  const jar = await cookies();
  const mode = modeOf(jar.get(MODE_COOKIE)?.value);
  const collapsed = jar.get(SIDEBAR_COOKIE)?.value === "collapsed";
  async function signOut() {
    "use server";
    await devSignOut();
    redirect("/sign-in");
  }

  const only = (ok: boolean, item: NavItem) => (ok ? [item] : []);
  const groups: NavGroup[] = [
    {
      label: "Workspace",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
        ...only(can(ctx, "appetite.read"), { href: "/markets", label: "Market Finder", icon: "markets" }),
        ...only(can(ctx, "guides.ask"), { href: "/ask", label: "Ask the guides", icon: "ask" }),
      ],
    },
    {
      label: "Directory",
      items: [
        { href: "/carriers", label: "Carriers", icon: "carriers", match: ["/appetite", "/commissions", "/extractions"] },
        ...only(can(ctx, "contact.read"), { href: "/contacts", label: "Contacts", icon: "contacts" }),
        ...only(can(ctx, "document.read"), { href: "/documents", label: "Documents", icon: "documents" }),
      ],
    },
    {
      label: "Activity",
      items: [
        ...only(can(ctx, "inbox.read"), { href: "/inbox", label: "Inbox", icon: "inbox" }),
        ...only(can(ctx, "change_request.review"), { href: "/approvals", label: "Approvals", icon: "approvals" }),
        { href: "/notifications", label: "Notifications", icon: "bell", badge: unread },
      ],
    },
    // Industry codes, Import, Users and Audit log live on Setup.
    ...(setupItems(ctx).length ? [{ label: "Admin", items: [{ href: "/setup", label: "Setup", icon: "setup", match: SETUP_PATHS }] }] : []),
  ].filter((g) => g.items.length);

  const initials = ctx.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const role = ctx.roles.includes("ADMIN") ? "Admin" : ctx.roles.includes("STAFF") ? "Staff" : "Limited access";
  const signOutButton = (
    <button className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
      <Icon name="logout" className="h-4 w-4" />
      Sign out
    </button>
  );

  return (
    <>
      {dev && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1 text-center text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200">
          Development sign-in (AUTH_DRIVER=dev). Not for real data.
        </div>
      )}
      <AppShell
        groups={groups}
        user={{ name: ctx.name, initials, role }}
        mode={mode}
        collapsedInitial={collapsed}
        signOut={dev ? <form action={signOut}>{signOutButton}</form> : <SignOutButton>{signOutButton}</SignOutButton>}
      >
        {children}
      </AppShell>
    </>
  );
}
