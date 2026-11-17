import { cache } from "react";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/theme";
import type { PermissionCode } from "./catalog";
import { can, type AuthContext } from "./context";

/**
 * Service layout vs admin tools (Josh, 2026-11-16). Service staff see a simple app: carriers,
 * phones, portals, markets and guides. People with any editing or approving permission can
 * flip "Admin tools" on (a cookie in this browser) to see the controls for managing data.
 *
 * This is presentation only. Hiding a button is not security: every server action and service
 * still checks permissions on its own (assertCan), whatever this switch says.
 */
const ADMIN_PERMISSIONS: PermissionCode[] = [
  "carrier.write", "contact.write", "appointment.write", "appetite.write", "appetite.approve",
  "commission.write", "commission.approve", "document.write", "change_request.review",
  "import.run", "audit.read", "inbox.read", "admin.users", "admin.settings",
];

/** Whether this person has anything the Admin tools switch would show. */
export function hasAdminTools(ctx: AuthContext): boolean {
  return ADMIN_PERMISSIONS.some((p) => can(ctx, p));
}

/** The switch as saved in this browser (off unless turned on). */
export const adminToolsOn = cache(async (): Promise<boolean> => (await cookies()).get(ADMIN_COOKIE)?.value === "on");

/** Show an edit, upload or approve control: the person may do it AND Admin tools is on. */
export async function showControl(ctx: AuthContext, permission: PermissionCode): Promise<boolean> {
  return can(ctx, permission) && (await adminToolsOn());
}
