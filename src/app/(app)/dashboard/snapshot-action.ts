"use server";

import { requireAuth } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { carrierSnapshot, type Snapshot } from "@/server/services/snapshot";

export type { Snapshot };

/** The Dashboard's Carrier SnapShot for one carrier. */
export async function carrierSnapshotAction(carrierId: string): Promise<{ ok: true; snapshot: Snapshot } | { ok: false; error: string }> {
  try {
    return { ok: true, snapshot: await carrierSnapshot(await requireAuth(), carrierId) };
  } catch (e) {
    if (e instanceof NotFoundError) return { ok: false, error: "Carrier not found." };
    throw e;
  }
}
