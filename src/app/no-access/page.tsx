import { SignOutButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authDriver } from "@/server/auth/session";
import { devSignOut } from "@/server/auth/dev";

export const metadata = { title: "No access" };

export default async function NoAccessPage() {
  await connection();
  const clerk = authDriver() === "clerk";
  async function signOut() {
    "use server";
    await devSignOut();
    redirect("/sign-in");
  }
  const button = <button className="self-start rounded border border-zinc-300 px-3 py-1.5 text-sm">Sign out</button>;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">You don&apos;t have access yet</h1>
      <p>
        Your account isn&apos;t set up in TIG Carrier Intelligence, or it has been deactivated. Ask an admin to invite you
        using your TIG Microsoft 365 email address.
      </p>
      {clerk ? <SignOutButton>{button}</SignOutButton> : <form action={signOut}>{button}</form>}
    </main>
  );
}
