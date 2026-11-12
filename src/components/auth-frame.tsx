/**
 * The sign-in and no-access screens: a deep navy brand panel beside a clean white form panel
 * (the brand panel hides on phones).
 */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside aria-hidden="true" className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden bg-rail p-10 text-white lg:flex">
        {/* A faint grid, for texture. */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500 text-xs font-bold text-[#0b1c30]">TIG</span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Carrier Intelligence</span>
            <span className="text-xs text-zinc-400">The Insurance Group</span>
          </span>
        </div>
        <div className="relative flex flex-col gap-4">
          <p className="max-w-sm text-3xl font-semibold leading-tight tracking-tight">Every carrier, market and appetite guide in one place.</p>
          <p className="max-w-sm text-sm text-zinc-300">Find the right market, check appetite against the guides, and keep contacts and codes current.</p>
        </div>
        <p className="relative text-xs text-zinc-400">Internal use only · The Insurance Group</p>
      </aside>
      <main className="flex flex-1 items-center justify-center bg-white px-4 py-12 dark:bg-zinc-950">
        <div className="flex w-full max-w-sm flex-col gap-5">{children}</div>
      </main>
    </div>
  );
}
