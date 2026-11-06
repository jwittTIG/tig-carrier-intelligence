import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { ACCENT_COOKIE, DEFAULT_ACCENT, accentCss, normalizeHex } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TIG Carrier Intelligence", template: "%s · TIG Carrier Intelligence" },
  description: "Internal P&C market, appetite, contact, appointment and commission reference for The Insurance Group.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The staff member's chosen color (cookie), validated as #rrggbb before it reaches CSS.
  const accent = normalizeHex((await cookies()).get(ACCENT_COOKIE)?.value) ?? DEFAULT_ACCENT;
  const page = (
    <html lang="en" className="h-full antialiased">
      <head>
        <style id="accent-theme">{accentCss(accent)}</style>
      </head>
      <body className="min-h-full flex flex-col bg-zinc-100 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">{children}</body>
    </html>
  );
  // Clerk is only loaded when it is the configured sign-in driver (DECISIONS D9).
  return process.env.AUTH_DRIVER === "clerk" ? <ClerkProvider>{page}</ClerkProvider> : page;
}
