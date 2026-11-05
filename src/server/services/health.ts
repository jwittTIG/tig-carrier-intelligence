import "server-only";
import { prisma } from "@/server/db/client";

export type DatabaseHealth = { ok: true; latencyMs: number } | { ok: false };

/** Runs `select 1`. Never returns error details (they can contain connection strings). */
export async function checkDatabase(): Promise<DatabaseHealth> {
  const started = performance.now();
  try {
    await prisma.$queryRaw`select 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    console.error("[health] database check failed", error instanceof Error ? error.name : "unknown");
    return { ok: false };
  }
}
