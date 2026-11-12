import { SignOutButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authDriver } from "@/server/auth/session";
import { devSignOut } from "@/server/auth/dev";
import { AuthFrame } from "@/components/auth-frame";

export const metadata = { title: "No access" };

export default async function NoAccessPage() {
  await connection();
  const clerk = authDriver() === "clerk";
  async function signOut() {
    "use server";
    await devSignOut();
    redirect("/sign-in");
  }
  const button = <button className="inline-flex min-h-8 items-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-800 shadow-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">Sign out</button>;
  return (
    <AuthFrame>
      <h1 className="text-2xl font-semibold tracking-tight text-blue-700 dark:text-zinc-100">You don&apos;t have access yet</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Your account isn&apos;t set up in TIG Carrier Intelligence, or it has been deactivated. Ask an admin to invite you
        using your TIG Microsoft 365 email address.
      </p>
      <div>{clerk ? <SignOutButton>{button}</SignOutButton> : <form action={signOut}>{button}</form>}</div>
    </AuthFrame>
  );
}
