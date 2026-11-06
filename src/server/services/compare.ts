import { z } from "zod";
import { todayUtc } from "@/lib/dates";
import { assertCan, can, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { fractionToPercent } from "./commissions";
import { findMarkets } from "./market";

/**
 * Market comparison (M7, DECISIONS D22): up to 4 Market Finder results side by side for the
 * same risk. Uses the same filters and risk values as the finder, then adds what staff weigh
 * when choosing: underwriting requirements, agency codes in use, and the approved commission
 * in effect today (only with commission.read). Nothing is saved.
 */

export const MAX_COMPARE = 4;
const keySchema = z.string().regex(/^[0-9a-f-]{36}:([0-9a-f-]{36}|none)$/);

function pickedKeys(input: Record<string, unknown>): string[] {
  const raw = input.pick;
  const list = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []).map((s) => String(s).trim()).filter(Boolean);
  const keys = [...new Set(list)];
  if (keys.length < 2) throw new ValidationError("Choose at least 2 markets to compare.");
  if (keys.length > MAX_COMPARE) throw new ValidationError(`Compare up to ${MAX_COMPARE} markets at a time.`);
  if (keys.some((k) => !keySchema.safeParse(k).success)) throw new ValidationError("Unknown market in the comparison.");
  return keys;
}

export async function compareMarkets(ctx: AuthContext, input: Record<string, unknown>) {
  assertCan(ctx, "appetite.read");
  const keys = pickedKeys(input);
  const found = await findMarkets(ctx, input);
  const all = new Map(found.groups.flatMap((g) => g.results).map((r) => [r.key, r]));
  const picked = keys.map((k) => all.get(k)).filter((r): r is NonNullable<typeof r> => !!r);
  if (picked.length !== keys.length) throw new ValidationError("A chosen market no longer matches this search. Run the search again.");

  const today = todayUtc();
  const cpIds = [...new Set(picked.map((r) => r.carrierProductId))];
  const channelIds = picked.map((r) => r.channelId).filter((x): x is string => !!x);
  const carrierProducts = await prisma.carrierProduct.findMany({
    where: { id: { in: cpIds } },
    select: { id: true, productId: true, requirements: { select: { id: true, requirementType: true, description: true }, orderBy: { requirementType: "asc" } } },
  });
  const cpById = new Map(carrierProducts.map((c) => [c.id, c]));

  const showCodes = can(ctx, "appointment.read");
  const codes = showCodes && channelIds.length
    ? await prisma.agencyCode.findMany({
        where: {
          status: "ACTIVE",
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
          appointment: { marketChannelId: { in: channelIds } },
        },
        select: { id: true, codeType: true, codeValue: true, appointment: { select: { marketChannelId: true } } },
        orderBy: { codeType: "asc" },
      })
    : [];

  const showCommission = can(ctx, "commission.read");
  const stateTerritory = found.filters.stateCode ? await prisma.territory.findFirst({ where: { stateCode: found.filters.stateCode, territoryType: "STATE" }, select: { id: true } }) : null;
  const schedules = showCommission && channelIds.length
    ? await prisma.commissionSchedule.findMany({
        where: {
          status: "APPROVED",
          transactionType: { in: ["NEW", "RENEWAL"] },
          effectiveFrom: { lte: today },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
          productId: { in: carrierProducts.map((c) => c.productId) },
          agreement: { status: "APPROVED", marketChannelId: { in: channelIds } },
          // Statewide schedules count everywhere; a state schedule only for that state.
          AND: [{ OR: [{ territoryId: null }, ...(stateTerritory ? [{ territoryId: stateTerritory.id }] : [])] }],
        },
        select: { id: true, productId: true, territoryId: true, transactionType: true, basis: true, rate: true, flatAmount: true, effectiveFrom: true, effectiveTo: true, agreementId: true, agreement: { select: { marketChannelId: true } }, tiers: { select: { id: true } } },
      })
    : [];

  const columns = picked.map((r) => {
    const cp = cpById.get(r.carrierProductId)!;
    const commission = (["NEW", "RENEWAL"] as const).map((type) => {
      const matches = schedules
        .filter((s) => s.transactionType === type && s.productId === cp.productId && s.agreement.marketChannelId === r.channelId)
        // A state-specific schedule is more specific than a nationwide one.
        .sort((a, b) => Number(!!b.territoryId) - Number(!!a.territoryId));
      const s = matches[0];
      if (!s) return { type, text: "Rate not recorded", agreementId: null as string | null };
      const text = s.basis === "RATE" && s.rate ? fractionToPercent(s.rate)
        : s.basis === "FLAT" && s.flatAmount ? `$${Number(s.flatAmount).toLocaleString("en-US")} flat`
        : s.basis === "TIERED" ? `Tiered (${s.tiers.length} ${s.tiers.length === 1 ? "tier" : "tiers"})`
        : "Rate not recorded";
      return { type, text: `${text}${s.territoryId ? " (this state)" : ""}`, agreementId: s.agreementId };
    });
    return {
      ...r,
      requirements: cp.requirements,
      codes: showCodes ? codes.filter((c) => c.appointment.marketChannelId === r.channelId).map((c) => ({ id: c.id, type: c.codeType, value: c.codeValue })) : null,
      commission: showCommission ? commission : null,
    };
  });

  return { disclaimer: found.disclaimer, filters: found.filters, attributes: found.attributes, risk: found.risk, columns };
}
