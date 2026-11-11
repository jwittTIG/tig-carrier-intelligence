"use server";

import { z } from "zod";
import { contactRoleLabel } from "@/lib/contact-roles";
import { requireAuth } from "@/server/auth/session";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listContactsForCarrier } from "@/server/services/contacts";

export type ContactCard = {
  assignmentId: string;
  contactId: string;
  name: string;
  type: string;
  title: string | null;
  email: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  territory: string | null;
  lines: string[];
  inactive: boolean;
};

/** The current contacts at one carrier, for the Dashboard's "Carrier contacts" tab. */
export async function carrierContactsAction(carrierId: string): Promise<{ ok: true; contacts: ContactCard[] } | { ok: false; error: string }> {
  if (!z.uuid().safeParse(carrierId).success) return { ok: false, error: "Pick a carrier." };
  try {
    const rows = await listContactsForCarrier(await requireAuth(), carrierId);
    return {
      ok: true,
      contacts: rows
        .filter((a) => a.current)
        .map((a) => ({
          assignmentId: a.id,
          contactId: a.contact.id,
          name: `${a.contact.firstName} ${a.contact.lastName}`,
          type: contactRoleLabel(a.role),
          title: a.title,
          email: a.contact.email,
          officePhone: a.contact.officePhone,
          mobilePhone: a.contact.mobilePhone,
          territory: a.territory?.name ?? null,
          lines: a.specialties.map((s) => s.product.name),
          inactive: a.contact.status !== "ACTIVE",
        })),
    };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "You don't have access to contacts." };
    if (e instanceof NotFoundError) return { ok: false, error: "Carrier not found." };
    throw e;
  }
}
