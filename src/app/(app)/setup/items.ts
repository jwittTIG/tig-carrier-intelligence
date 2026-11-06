import { can, type AuthContext } from "@/server/auth/context";

/** Pages listed on Setup, each shown only to people who can use it. */
export function setupItems(ctx: AuthContext) {
  return [
    can(ctx, "appetite.read") && {
      href: "/setup/industries",
      icon: "industries",
      title: "Industry codes and search words",
      text: "NAICS 2022 codes used by the Market Finder. Add the words staff use (e.g. “hvac”) so searches find the right code.",
    },
    can(ctx, "import.run") && {
      href: "/imports",
      icon: "imports",
      title: "Import from a spreadsheet",
      text: "Load carriers and contacts from a CSV: preview, fix errors, then commit all at once.",
    },
    can(ctx, "admin.users") && {
      href: "/admin/users",
      icon: "users",
      title: "Users",
      text: "Invite staff, change roles, and deactivate people who leave.",
    },
    can(ctx, "audit.read") && {
      href: "/admin/audit",
      icon: "audit",
      title: "Audit log",
      text: "Every change: who made it, when, and what it was before and after.",
    },
  ].filter((x): x is { href: string; icon: string; title: string; text: string } => !!x);
}

/** Paths that count as part of Setup (the menu highlights Setup on them). */
export const SETUP_PATHS = ["/setup", "/imports", "/admin"];
