/**
 * Placeholder home page. Milestone 1 is the data foundation only: no sign-in and no
 * screens yet, so nothing here links to unfinished features.
 */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">TIG Carrier Intelligence</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Internal tool for The Insurance Group. Under construction: Milestone 1 (database foundation) only.
        Sign-in and the carrier directory arrive in Milestone 2.
      </p>
    </main>
  );
}
