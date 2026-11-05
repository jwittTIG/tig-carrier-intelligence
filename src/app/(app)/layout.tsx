import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { can } from "@/server/auth/context";
import { authDriver, requireAuth } from "@/server/auth/session";
import { devSignOut } from "@/server/auth/dev";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireAuth();
  const dev = authDriver() === "dev";
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
          <Link href="/carriers" className="font-semibold">TIG Carrier Intelligence</Link>
          <Link href="/carriers" className="hover:underline">Carriers</Link>
          {can(ctx, "contact.read") && <Link href="/contacts" className="hover:underline">Contacts</Link>}
          {can(ctx, "appointment.read") && <Link href="/codes" className="hover:underline">Codes</Link>}
          {can(ctx, "admin.users") && <Link href="/admin/users" className="hover:underline">Users</Link>}
          <span className="ml-auto text-zinc-600 dark:text-zinc-400">{ctx.name}</span>
          {dev ? <form action={signOut}>{signOutButton}</form> : <SignOutButton>{signOutButton}</SignOutButton>}
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">{children}</main>
    </>
  );
}
