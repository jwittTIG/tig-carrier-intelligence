import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authDriver } from "@/server/auth/session";
import { devSignIn, devSignInUsers } from "@/server/auth/dev";
import { AuthFrame } from "@/components/auth-frame";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  await connection();
  if (authDriver() === "clerk") {
    return (
      <AuthFrame>
        <SignIn />
      </AuthFrame>
    );
  }

  const users = await devSignInUsers();
  async function signIn(form: FormData) {
    "use server";
    await devSignIn(String(form.get("userId")));
    redirect("/dashboard");
  }

  return (
    <AuthFrame>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-blue-700 dark:text-zinc-100">Sign in</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Choose an account to continue.</p>
      </div>
      <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
        <strong className="font-semibold">Development sign-in.</strong> Staff will sign in with Microsoft 365. This page only exists while
        AUTH_DRIVER=dev, and it is refused in production.
      </div>
      <ul className="flex flex-col gap-2">
        {users.map((u) => (
          <li key={u.id}>
            <form action={signIn}>
              <input type="hidden" name="userId" value={u.id} />
              <button type="submit" className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left text-sm shadow-xs hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800">
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-semibold text-white">
                  {u.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")}
                </span>
                <span className="flex-1">
                  Sign in as <strong className="font-semibold">{u.name}</strong>{" "}
                  <span className="text-zinc-600 dark:text-zinc-400">({u.roleScopes.map((r) => r.role.code).join(", ") || "no role"})</span>
                </span>
                <span aria-hidden="true" className="text-zinc-400">→</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </AuthFrame>
  );
}
