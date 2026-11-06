import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";

/** Carrier products (optionally for one carrier), labeled for pickers. */
export async function listCarrierProducts(ctx: AuthContext, organizationId: string | null) {
  assertCan(ctx, "carrier.read");
  const rows = await prisma.carrierProduct.findMany({
    where: { archivedAt: null, ...(organizationId ? { writingCompanyId: organizationId } : { writingCompany: { archivedAt: null } }) },
    orderBy: [{ writingCompany: { displayName: "asc" } }],
    take: 500,
    select: { id: true, product: { select: { name: true } }, writingCompany: { select: { displayName: true } } },
  });
  return rows.map((r) => ({ id: r.id, label: `${r.writingCompany.displayName}: ${r.product.name}` }));
}

/** Inbox items filed under a carrier, for its Updates tab. */
export async function listCarrierUpdates(ctx: AuthContext, organizationId: string) {
  assertCan(ctx, "inbox.read");
  return prisma.inboundMessage.findMany({
    where: { organizationId, senderStatus: "ACCEPTED" },
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: { id: true, subject: true, receivedAt: true, originalFrom: true, fromAddress: true, status: true, _count: { select: { attachments: true } } },
  });
}
