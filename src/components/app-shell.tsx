"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setModeAction, setSidebarAction } from "@/app/theme-actions";
import type { Mode } from "@/lib/theme";
import { Icon } from "./icons";

export type NavItem = { href: string; label: string; icon: string; badge?: number; /** Other paths that highlight this item. */ match?: string[] };
export type NavGroup = { label: string; items: NavItem[] };
type User = { name: string; initials: string; role: string };

/**
 * The app frame (2026-11-11 redesign): deep navy sidebar with grouped navigation that collapses
 * to icons, a slim top bar (page name, search, theme toggle, user menu), and the workspace.
 * On phones the sidebar slides in from the left.
 */
export function AppShell({ groups, user, signOut, collapsedInitial, mode, children }: { groups: NavGroup[]; user: User; signOut: React.ReactNode; collapsedInitial: boolean; mode: Mode; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(collapsedInitial);
  const [mobileOpen, setMobileOpen] = useState(false);
  const path = usePathname();
  const under = (p: string) => path === p || path.startsWith(`${p}/`);
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => [i.href, ...(i.match ?? [])].some(under));


  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    void setSidebarAction(next);
  };

  return (
    <div className="flex min-h-[calc(100vh-var(--banner,0px))]">
      {/* Phones: dimmed backdrop behind the slide-in menu. */}
      {mobileOpen && <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-zinc-950/40 backdrop-blur-[1px] lg:hidden" />}
      <aside
        aria-label="Sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-rail text-zinc-300 transition-[width,transform] duration-200 ease-out lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${collapsed ? "lg:w-16" : "lg:w-60"} w-64 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 ${collapsed ? "lg:justify-center lg:px-0" : ""} px-4`}>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 rounded-lg" aria-label="TIG Carrier Intelligence, Dashboard">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500 text-[11px] font-bold tracking-tight text-[#0b1c30]">TIG</span>
            <span className={`flex min-w-0 flex-col leading-tight ${collapsed ? "lg:hidden" : ""}`}>
              <span className="truncate text-[13px] font-semibold text-white">Carrier Intelligence</span>
              <span className="truncate text-[11px] text-zinc-400">The Insurance Group</span>
            </span>
          </Link>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map((g) => (
            <div key={g.label} className="mb-4 last:mb-0">
              <p className={`px-2.5 pb-1 text-[11px] font-medium tracking-wide text-zinc-400 ${collapsed ? "lg:sr-only" : ""}`}>{g.label}</p>
              <ul className="flex flex-col gap-px">
                {g.items.map((i) => {
                  const on = [i.href, ...(i.match ?? [])].some(under);
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        aria-current={on ? "page" : undefined}
                        aria-label={i.badge ? `${i.label}, ${i.badge} unread` : collapsed ? i.label : undefined}
                        title={collapsed ? i.label : undefined}
                        onClick={() => setMobileOpen(false)}
                        className={`group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium ${collapsed ? "lg:justify-center lg:px-0" : ""} ${on ? "bg-rail-active text-white" : "text-zinc-300 hover:bg-rail-hover hover:text-white"}`}
                      >
                        {on && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-orange-500" />}
                        <Icon name={i.icon} className={`h-4 w-4 shrink-0 ${on ? "text-orange-400" : "text-zinc-400 group-hover:text-zinc-200"}`} />
                        <span className={`flex-1 truncate ${collapsed ? "lg:sr-only" : ""}`}>{i.label}</span>
                        {!!i.badge && (
                          <span className={`rounded-full bg-orange-500 px-1.5 text-[11px] font-semibold leading-4 text-[#0b1c30] ${collapsed ? "lg:absolute lg:right-1 lg:top-0.5 lg:px-1" : ""}`}>
                            {i.badge}
                            <span className="sr-only"> unread</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="hidden shrink-0 border-t border-white/10 p-2 lg:block">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-zinc-400 hover:bg-rail-hover hover:text-white ${collapsed ? "justify-center px-0" : ""}`}
          >
            <Icon name={collapsed ? "expand" : "collapse"} className="h-4 w-4" />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/75 sm:px-6 lg:px-8 dark:border-zinc-800 dark:bg-zinc-950/85">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-expanded={mobileOpen} className="-ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 lg:hidden dark:text-zinc-300 dark:hover:bg-zinc-800">
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <p className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="hidden text-zinc-600 sm:inline dark:text-zinc-400">TIG</span>
            <span aria-hidden="true" className="hidden text-zinc-300 sm:inline dark:text-zinc-600">/</span>
            <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{current?.label ?? (under("/search") ? "Search" : "Carrier Intelligence")}</span>
          </p>
          <form action="/search" method="get" role="search" className="ml-auto hidden w-full max-w-xs md:block">
            <label htmlFor="globalSearch" className="sr-only">Search carriers, contacts, codes and documents</label>
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                id="globalSearch"
                name="q"
                type="search"
                placeholder="Search carriers, contacts, codes…"
                className="h-8 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-8 pr-3 text-[13px] text-zinc-900 outline-none hover:border-zinc-300 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:bg-zinc-900"
              />
            </div>
          </form>
          <Link href="/search" aria-label="Search" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-800">
            <Icon name="search" className="h-4 w-4" />
          </Link>
          <ThemeToggle mode={mode} />
          <UserMenu user={user} signOut={signOut} />
        </header>
        <main className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function ThemeToggle({ mode }: { mode: Mode }) {
  const [dark, setDark] = useState(mode === "dark");
  const [, start] = useTransition();
  const router = useRouter();
  useThemeClass(dark);
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next); // instant; the cookie keeps it next time
    start(async () => {
      await setModeAction(next ? "dark" : "light");
      router.refresh(); // the page frame picks up the saved choice
    });
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
    >
      <Icon name={dark ? "sun" : "moon"} className="h-4 w-4" />
    </button>
  );
}

/** Keeps the dark class on <html> after page changes (a cached page frame may not have it yet). */
function useThemeClass(dark: boolean) {
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  });
}

function UserMenu({ user, signOut }: { user: User; signOut: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Account: ${user.name}`}
        className="flex h-8 items-center gap-2 rounded-lg pl-1 pr-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-700 text-[11px] font-semibold text-white ring-2 ring-orange-500/70">{user.initials}</span>
        <Icon name="chevron" className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        hidden={!open}
        className="absolute right-0 top-10 z-50 w-56 origin-top-right rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="px-2.5 py-2">
          <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{user.name}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{user.role}</p>
        </div>
        <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        {signOut}
      </div>
    </div>
  );
}
