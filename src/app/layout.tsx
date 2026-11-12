import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { MODE_COOKIE, modeOf } from "@/lib/theme";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "TIG Carrier Intelligence", template: "%s · TIG Carrier Intelligence" },
  description: "Internal P&C market, appetite, contact, appointment and commission reference for The Insurance Group.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const mode = modeOf((await cookies()).get(MODE_COOKIE)?.value);
  const page = (
    <html lang="en" className={`h-full ${geist.variable} ${geistMono.variable}${mode === "dark" ? " dark" : ""}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
  // Clerk is only loaded when it is the configured sign-in driver (DECISIONS D9).
  return process.env.AUTH_DRIVER === "clerk" ? <ClerkProvider>{page}</ClerkProvider> : page;
}
