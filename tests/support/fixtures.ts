import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

const tag = () => randomUUID().slice(0, 8);

/**
 * Builds a fresh, fictional market chain for one test:
 * user, agency entity, insurer, product, carrier product, direct channel, appointment,
 * commission agreement, and an uploaded document version.
 */
export async function marketChain(db: PrismaClient) {
  const t = tag();
  const user = await db.user.create({ data: { name: `TEST User ${t}`, email: `test.${t}@example.invalid`, status: "ACTIVE" } });
  const agencyOrg = await db.organization.create({ data: { legalName: `TEST Agency ${t}`, displayName: `TEST Agency ${t}`, type: "AGENCY" } });
  const agency = await db.agencyEntity.create({ data: { organizationId: agencyOrg.id } });
  const insurer = await db.organization.create({ data: { legalName: `TEST Insurer ${t}`, displayName: `TEST Insurer ${t}`, type: "INSURER" } });
  const line = await db.lineOfBusiness.findUniqueOrThrow({ where: { code: "GENERAL_LIABILITY" } });
  const product = await db.insuranceProduct.create({ data: { lineId: line.id, code: `TEST_${t}`, name: `TEST Product ${t}` } });
  const carrierProduct = await db.carrierProduct.create({ data: { writingCompanyId: insurer.id, productId: product.id } });
  const channel = await db.marketChannel.create({ data: { carrierProductId: carrierProduct.id, distributionType: "DIRECT" } });
  const appointment = await db.agencyAppointment.create({
    data: { agencyEntityId: agency.id, marketChannelId: channel.id, appointmentType: "DIRECT", status: "ACTIVE", effectiveFrom: new Date("2026-01-01") },
  });
  const agreement = await db.commissionAgreement.create({ data: { agencyEntityId: agency.id, marketChannelId: channel.id } });
  const document = await db.document.create({ data: { title: `TEST Agreement ${t}`, documentType: "AGREEMENT", classification: "RESTRICTED" } });
  const documentVersion = await db.documentVersion.create({
    data: { documentId: document.id, versionNumber: 1, objectKey: `test/${t}.pdf`, sha256: "a".repeat(64), mimeType: "application/pdf", sizeBytes: BigInt(1024), uploadedById: user.id },
  });
  return { t, user, agency, insurer, product, carrierProduct, channel, appointment, agreement, document, documentVersion };
}
