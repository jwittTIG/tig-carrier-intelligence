/**
 * Permission and role catalog. Seeded into the database (prisma/seed.ts) and used for
 * type-safe checks in code. DECISIONS D1: everyone sees everything for now; only user
 * and settings administration is limited to ADMIN.
 */
export const PERMISSIONS = [
  { code: "carrier.read", description: "View carriers, products and channels" },
  { code: "carrier.write", description: "Create and edit carriers, products and channels" },
  { code: "contact.read", description: "View underwriter and marketing contacts" },
  { code: "contact.write", description: "Create and edit contacts" },
  { code: "appointment.read", description: "View appointments, agency codes and portal links" },
  { code: "appointment.write", description: "Create and edit appointments, agency codes and portal links" },
  { code: "appetite.read", description: "View appetite profiles and rules" },
  { code: "appetite.write", description: "Propose appetite changes" },
  { code: "appetite.approve", description: "Approve appetite profiles" },
  { code: "commission.read", description: "View commission agreements and schedules" },
  { code: "commission.write", description: "Create and edit commission agreements and schedules" },
  { code: "commission.approve", description: "Approve commission agreements and schedules" },
  { code: "document.read", description: "View and download documents" },
  { code: "document.write", description: "Upload and classify documents" },
  { code: "change_request.review", description: "Approve or reject change requests" },
  { code: "import.run", description: "Run CSV imports" },
  { code: "audit.read", description: "View the audit log" },
  { code: "inbox.read", description: "View emails taken in from the carrier-updates mailbox" },
  { code: "inbox.triage", description: "File, cite, draft from, or dismiss inbox emails" },
  { code: "inbox.manage", description: "Check the mailbox now, and accept or discard emails from unknown senders" },
  { code: "admin.users", description: "Manage users and roles" },
  { code: "admin.settings", description: "Manage taxonomy and settings" },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

const ADMIN_ONLY: PermissionCode[] = ["admin.users", "admin.settings", "inbox.manage"];

export const ROLES = [
  { code: "STAFF", name: "Staff", description: "TIG staff: can view and edit everything except users and settings", permissions: PERMISSIONS.map((p) => p.code).filter((c) => !ADMIN_ONLY.includes(c)) },
  { code: "ADMIN", name: "Admin", description: "TIG staff who also manage users, roles, taxonomy and settings", permissions: PERMISSIONS.map((p) => p.code) },
] as const;

export type RoleCode = (typeof ROLES)[number]["code"];
export const ROLE_CODES = ROLES.map((r) => r.code) as RoleCode[];
