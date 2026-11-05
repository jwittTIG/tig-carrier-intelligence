import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authDriver } from "@/server/auth/session";
import { devSignIn, devSignInUsers } from "@/server/auth/dev";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  await connection();
  if (authDriver() === "clerk") {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <SignIn />
      </main>
    );
  }

  const users = await devSignInUsers();
  async function signIn(form: FormData) {
    "use server";
    await devSignIn(String(form.get("userId")));
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">TIG Carrier Intelligence</h1>
      <div role="note" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <strong>Development sign-in.</strong> Staff will sign in with Microsoft 365. This page only exists while
        AUTH_DRIVER=dev, and it is refused in production.
      </div>
      <ul className="flex flex-col gap-2">
        {users.map((u) => (
          <li key={u.id}>
            <form action={signIn}>
              <input type="hidden" name="userId" value={u.id} />
              <button type="submit" className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900">
                Sign in as <strong>{u.name}</strong>{" "}
                <span className="text-zinc-500">({u.roleScopes.map((s) => s.role.code).join(", ") || "no role"})</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
