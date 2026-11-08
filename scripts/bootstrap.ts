/**
 * One-time setup for a fresh database with no DEMO data: creates the first Admin and the
 * agency's legal entity (codes and commission agreements belong to an agency entity).
 * Real names are passed on the command line, never stored in the repo.
 *
 *   npx tsx scripts/bootstrap.ts --admin-email you@tigknoxville.com --admin-name "Your Name" \
 *     --agency "The Insurance Group" [--agency-legal "Legal name"] [--state TN]
 *
 * Safe to run again: it updates the same user and agency instead of adding duplicates.
 * Uses DATABASE_URL from .env.local.
 */
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

config({ path: ".env.local", quiet: true });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]?.trim() || undefined : undefined;
}

async function main() {
  const email = arg("admin-email")?.toLowerCase();
  const name = arg("admin-name");
  const agency = arg("agency");
  const legal = arg("agency-legal") ?? agency;
  const state = arg("state")?.toUpperCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name || !agency) {
    throw new Error('Usage: tsx scripts/bootstrap.ts --admin-email <email> --admin-name "<name>" --agency "<agency name>" [--agency-legal "<legal name>"] [--state TN]');
  }
  if (state && !/^[A-Z]{2}$/.test(state)) throw new Error("--state must be a two-letter state code");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { code: "ADMIN" } });
      if (!role) throw new Error("Roles are missing: run `npm run db:seed` first.");
      const user = await tx.user.upsert({ where: { email }, update: { name, status: "ACTIVE" }, create: { email, name, status: "ACTIVE" } });
      const hasAdmin = await tx.userRoleScope.findFirst({ where: { userId: user.id, roleId: role.id } });
      if (!hasAdmin) await tx.userRoleScope.create({ data: { userId: user.id, roleId: role.id } });

      let org = await tx.organization.findFirst({ where: { type: "AGENCY", displayName: agency } });
      org = org
        ? await tx.organization.update({ where: { id: org.id }, data: { legalName: legal! } })
        : await tx.organization.create({ data: { legalName: legal!, displayName: agency, type: "AGENCY" } });
      const entity = await tx.agencyEntity.upsert({
        where: { organizationId: org.id },
        update: { status: "ACTIVE", ...(state && { domicileState: state }) },
        create: { organizationId: org.id, domicileState: state ?? null },
      });
      await tx.auditEvent.create({ data: { actorId: null, action: "setup.bootstrap", entityType: "user", entityId: user.id, afterState: { admin: email, agencyEntityId: entity.id, agency } } });
      console.log(`Admin: ${name} <${email}>. Agency entity: ${agency}${state ? ` (${state})` : ""}.`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
