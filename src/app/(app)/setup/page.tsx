import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { ForbiddenError } from "@/server/errors";
import { Icon } from "@/components/icons";
import { setupItems } from "./items";

export const metadata = { title: "Setup" };

/** Reference data and configuration staff adjust now and then, kept out of the main menu. */
export default async function SetupPage() {
  const ctx = await requireAuth();
  const items = setupItems(ctx);
  if (!items.length) throw new ForbiddenError();
  return (
    <>
      <h1 className="page-title">Setup</h1>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex h-full items-start gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs transition hover:border-blue-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-blue-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-blue-200"><Icon name={i.icon} /></span>
              <span className="flex flex-col gap-1">
                <span className="font-semibold text-blue-800 dark:text-blue-200">{i.title}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">{i.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
