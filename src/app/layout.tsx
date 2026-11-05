import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TIG Carrier Intelligence", template: "%s · TIG Carrier Intelligence" },
  description: "Internal P&C market, appetite, contact, appointment and commission reference for The Insurance Group.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const page = (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">{children}</body>
    </html>
  );
  // Clerk is only loaded when it is the configured sign-in driver (DECISIONS D9).
  return process.env.AUTH_DRIVER === "clerk" ? <ClerkProvider>{page}</ClerkProvider> : page;
}
