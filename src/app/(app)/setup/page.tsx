import Link from "next/link";
import { requireAuth } from "@/server/auth/session";
import { assertCan } from "@/server/auth/context";
import { Icon } from "@/components/icons";

export const metadata = { title: "Setup" };

/** Reference data and configuration staff adjust now and then, kept out of the main menu. */
export default async function SetupPage() {
  const ctx = await requireAuth();
  assertCan(ctx, "appetite.read");
  const items = [
    {
      href: "/setup/industries",
      icon: "industries",
      title: "Industry codes and search words",
      text: "NAICS 2022 codes used by the Market Finder. Add the words staff use (e.g. “hvac”) so searches find the right code.",
    },
  ];
  return (
    <>
      <h1 className="text-xl font-semibold">Setup</h1>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex h-full items-start gap-4 rounded-2xl border border-transparent bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-4 border-blue-200 bg-blue-600 text-white dark:border-blue-800"><Icon name={i.icon} /></span>
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
