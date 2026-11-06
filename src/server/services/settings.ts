import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { AppError } from "@/server/errors";

export class SettingNotConfiguredError extends AppError {
  constructor(key: string) {
    super(`Setting not configured: ${key}`, 500, "setting_not_configured");
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Reads a numeric admin setting (seeded in prisma/seed.ts). No hidden fallback values.
 * Inside a transaction, pass `tx`: reading through the global client would wait for a second
 * connection while the transaction holds one.
 */
export async function numberSetting(key: string, db: Db = prisma): Promise<number> {
  const row = await db.appSetting.findUnique({ where: { key } });
  const n = typeof row?.value === "number" ? row.value : Number(row?.value);
  if (!row || !Number.isFinite(n) || n < 0) throw new SettingNotConfiguredError(key);
  return n;
}

export async function textSetting(key: string, db: Db = prisma): Promise<string> {
  const row = await db.appSetting.findUnique({ where: { key } });
  if (!row || typeof row.value !== "string") throw new SettingNotConfiguredError(key);
  return row.value;
}

export const SETTING = {
  contactReviewDays: "contact.review_cadence_days",
  appetiteReviewDays: "appetite.review_cadence_days",
  searchDisclaimer: "search.disclaimer",
} as const;
