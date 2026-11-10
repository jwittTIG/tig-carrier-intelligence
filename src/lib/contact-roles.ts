import type { ContactRole } from "@/generated/prisma/enums";

/** Contact types, in the order staff pick from (Josh, 2026-11-10). Codes are stored; labels are shown. */
export const CONTACT_ROLES: { code: ContactRole; label: string }[] = [
  { code: "MARKETING_REP", label: "Marketing rep" },
  { code: "PL_UNDERWRITER", label: "PL underwriter (personal lines)" },
  { code: "CL_UNDERWRITER", label: "CL underwriter (commercial lines)" },
  { code: "SMALL_COMMERCIAL_UNDERWRITER", label: "Small commercial underwriter" },
  { code: "MIDDLE_MARKET_UNDERWRITER", label: "Middle market underwriter" },
  { code: "SPECIALTY_UNDERWRITER", label: "Specialty / E&S underwriter" },
  { code: "MARINE_UNDERWRITER", label: "Marine underwriter" },
  { code: "WORKERS_COMP_UNDERWRITER", label: "Workers' comp underwriter" },
  { code: "SURETY_UNDERWRITER", label: "Surety underwriter" },
  { code: "UNDERWRITER", label: "Underwriter (other)" },
  { code: "UNDERWRITING_MANAGER", label: "Underwriting manager" },
  { code: "CLAIMS_ADJUSTER", label: "Claims adjuster" },
  { code: "CLAIMS_MANAGER", label: "Claims manager" },
  { code: "CLAIMS", label: "Claims (other)" },
  { code: "LOSS_CONTROL", label: "Loss control / risk engineer" },
  { code: "PREMIUM_AUDITOR", label: "Premium auditor" },
  { code: "SERVICE", label: "Customer service" },
  { code: "BILLING", label: "Billing / accounting" },
  { code: "REGIONAL_MANAGER", label: "Regional manager" },
  { code: "BRANCH_MANAGER", label: "Branch manager" },
  { code: "PRODUCT_MANAGER", label: "Product manager" },
  { code: "OTHER", label: "Other" },
];

const LABELS = new Map(CONTACT_ROLES.map((r) => [r.code as string, r.label]));
export const contactRoleLabel = (code: string) => LABELS.get(code) ?? code;

/** Who the Market Finder lists as the people to call about a risk. */
export const MARKET_CONTACT_ROLES: ContactRole[] = [
  "MARKETING_REP",
  "UNDERWRITER",
  "PL_UNDERWRITER",
  "CL_UNDERWRITER",
  "SMALL_COMMERCIAL_UNDERWRITER",
  "MIDDLE_MARKET_UNDERWRITER",
  "SPECIALTY_UNDERWRITER",
  "MARINE_UNDERWRITER",
  "WORKERS_COMP_UNDERWRITER",
  "SURETY_UNDERWRITER",
  "UNDERWRITING_MANAGER",
];

/** Identifier types staff pick from. Stored as these codes (free text in the database). */
export const IDENTIFIER_TYPES = [
  { code: "NAIC", label: "NAIC" },
  { code: "FEIN", label: "FEIN" },
  { code: "AM_BEST_ID", label: "AM Best" },
] as const;
export const identifierLabel = (code: string) => IDENTIFIER_TYPES.find((t) => t.code === code)?.label ?? code;
