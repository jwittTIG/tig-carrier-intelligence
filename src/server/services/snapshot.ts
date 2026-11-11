import { z } from "zod";
import { assertCan, can, type AuthContext } from "@/server/auth/context";
import { NotFoundError } from "@/server/errors";
import { listCodesForCarrier } from "./appointments";
import { carrierLogoUrl, getCarrier } from "./carriers";
import { listContactsForCarrier } from "./contacts";

export type Snapshot = {
  id: string;
  name: string;
  logoUrl: string | null;
  portalUrl: string | null;
  phones: { main: string | null; billing: string | null; claims: string | null };
  /** Null when the person can't see contacts. */
  reps: { contactId: string; name: string; email: string | null; phone: string | null }[] | null;
  /** In-use codes, one entry per code value and type with the lines it's for. Null when the person can't see codes. */
  codes: { value: string; type: string; lines: string[]; producer: string | null }[] | null;
};

/** One carrier's key numbers for the Dashboard's Carrier SnapShot (Josh, 2026-11-11). Sections the person can't see come back null. */
export async function carrierSnapshot(ctx: AuthContext, carrierId: string): Promise<Snapshot> {
  assertCan(ctx, "carrier.read");
  if (!z.uuid().safeParse(carrierId).success) throw new NotFoundError("Carrier not found.");
  const carrier = await getCarrier(ctx, carrierId);
  const [contacts, codes, logoUrl] = await Promise.all([
    can(ctx, "contact.read") ? listContactsForCarrier(ctx, carrierId) : Promise.resolve(null),
    can(ctx, "appointment.read") ? listCodesForCarrier(ctx, carrierId) : Promise.resolve(null),
    carrierLogoUrl(ctx, carrier),
  ]);
  const grouped = new Map<string, { value: string; type: string; lines: string[]; producer: string | null }>();
  for (const c of codes?.filter((x) => x.inUse) ?? []) {
    const key = `${c.codeType}:${c.codeValue}:${c.assignedUser?.id ?? ""}`;
    const line = c.appointment.marketChannel.carrierProduct.product.name;
    const g = grouped.get(key) ?? { value: c.codeValue, type: c.codeType, lines: [], producer: c.assignedUser?.name ?? null };
    if (!g.lines.includes(line)) g.lines.push(line);
    grouped.set(key, g);
  }
  return {
    id: carrier.id,
    name: carrier.displayName,
    logoUrl,
    portalUrl: carrier.portalUrl,
    phones: { main: carrier.mainPhone, billing: carrier.billingPhone, claims: carrier.claimsPhone },
    reps: contacts
      ? contacts
          .filter((a) => a.current && a.role === "MARKETING_REP" && a.contact.status === "ACTIVE")
          .map((a) => ({ contactId: a.contact.id, name: `${a.contact.firstName} ${a.contact.lastName}`, email: a.contact.email, phone: a.contact.officePhone ?? a.contact.mobilePhone }))
      : null,
    // Master codes first, then by value.
    codes: codes ? [...grouped.values()].sort((a, b) => Number(b.type === "MASTER") - Number(a.type === "MASTER") || a.value.localeCompare(b.value)) : null,
  };
}
