import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";
import { assertCan, type AuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/server/errors";
import { optionalId, parse, requiredText } from "@/server/validation";
import { guideReader, PROMPT_VERSION, readerMode, type GuideDoc, type ReaderResult } from "@/server/ai/guide-reader";

/**
 * Ask the guides (M8, DECISIONS D12, N21): a question about one carrier, answered by AI from
 * that carrier's guide PDFs, with page citations. Every question is logged. Answers are the
 * AI's reading of the guides, not approved appetite.
 */

export const MAX_GUIDES = 5;
const GUIDE_TYPES = ["APPETITE_GUIDE", "UNDERWRITING_GUIDELINES"] as const;
export const GUIDE_DISCLAIMER = "AI reading of the carrier's guide, not a coverage commitment or approved appetite. Confirm with the underwriter before relying on it.";

export function aiStatus() {
  return { mode: readerMode() };
}

/** Carriers (not agencies) whose name appears in the question as whole words. Longest name wins. */
export function detectCarrier<T extends { id: string; displayName: string; legalName: string }>(question: string, carriers: T[]): T | null {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9&]+/g, " ")} `;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
  const hits = carriers
    .map((c) => ({ c, len: Math.max(...[c.displayName, c.legalName].map(norm).filter((n) => n.length >= 3 && q.includes(` ${n} `)).map((n) => n.length), 0) }))
    .filter((h) => h.len > 0)
    .sort((a, b) => b.len - a.len);
  if (!hits.length) return null;
  if (hits.length > 1 && hits[1].len === hits[0].len) return null; // ambiguous
  return hits[0].c;
}

/** A carrier's guides: filed under it, active, not restricted, latest version; readable if PDF. */
export async function listGuides(ctx: AuthContext, organizationId: string) {
  assertCan(ctx, "document.read");
  const filed = await prisma.recordSource.findMany({
    where: { recordType: "ORGANIZATION", recordId: organizationId, documentVersionId: { not: null } },
    select: { documentVersion: { select: { documentId: true } } },
  });
  const ids = [...new Set(filed.map((f) => f.documentVersion!.documentId))];
  const docs = await prisma.document.findMany({
    where: { id: { in: ids }, status: "ACTIVE", classification: { not: "RESTRICTED" }, documentType: { in: [...GUIDE_TYPES] } },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });
  return docs
    .filter((d) => d.versions.length)
    .map((d) => {
      const v = d.versions[0];
      return { documentId: d.id, title: d.title, documentType: d.documentType, documentVersionId: v.id, versionNumber: v.versionNumber, uploadedAt: v.uploadedAt, mimeType: v.mimeType, objectKey: v.objectKey, readable: v.mimeType === "application/pdf" };
    });
}

export async function listAskableCarriers(ctx: AuthContext) {
  assertCan(ctx, "guides.ask");
  return prisma.organization.findMany({ where: { type: { not: "AGENCY" }, archivedAt: null }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, legalName: true } });
}

const askSchema = z.object({ question: requiredText(1000), organizationId: optionalId });

export type Citation = { documentVersionId: string; documentId: string; title: string; versionNumber: number; startPage: number; endPage: number; quote: string };

/** Asks one carrier's guides. Logs the question whatever happens (answered, refused, failed). */
export async function askGuides(ctx: AuthContext, input: unknown) {
  assertCan(ctx, "guides.ask");
  assertCan(ctx, "document.read");
  const { question, organizationId } = parse(askSchema, input);
  if (question.length < 3) throw new ValidationError("Type a question.");
  const carriers = await listAskableCarriers(ctx);
  const carrier = organizationId ? carriers.find((c) => c.id === organizationId) : detectCarrier(question, carriers);
  if (organizationId && !carrier) throw new NotFoundError("Carrier not found.");
  if (!carrier) throw new ValidationError("Which carrier? Pick one, or name it in the question (for example \"Will Travelers write…\").");

  const guides = (await listGuides(ctx, carrier.id)).filter((g) => g.readable).slice(0, MAX_GUIDES);
  if (!guides.length) throw new ValidationError(`${carrier.displayName} has no PDF appetite guide or underwriting guidelines yet. Upload one on the carrier's Documents tab (type Appetite guide or Underwriting guidelines).`);
  const reader = guideReader();
  if (!reader) throw new ValidationError("AI isn't set up yet: add ANTHROPIC_API_KEY to .env.local and restart the app.");

  const docs: GuideDoc[] = guides.map((g) => ({ documentVersionId: g.documentVersionId, title: g.title, versionNumber: g.versionNumber, objectKey: g.objectKey, mimeType: g.mimeType }));
  let result: ReaderResult | null = null;
  let error: string | null = null;
  try {
    result = await reader.read({ question, carrierName: carrier.displayName, docs });
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 1000) : "Unknown error";
  }
  const citations: Citation[] =
    result?.status === "ANSWERED"
      ? result.citations
          .filter((c) => guides[c.docIndex])
          .map((c) => ({ documentVersionId: guides[c.docIndex].documentVersionId, documentId: guides[c.docIndex].documentId, title: guides[c.docIndex].title, versionNumber: guides[c.docIndex].versionNumber, startPage: c.startPage, endPage: c.endPage, quote: c.quote }))
      : [];

  return prisma.$transaction(async (tx) => {
    const row = await tx.guideQuestion.create({
      data: {
        askedById: ctx.userId,
        organizationId: carrier.id,
        question,
        status: result ? result.status : "FAILED",
        verdict: result?.status === "ANSWERED" ? result.verdict : null,
        answerText: result?.status === "ANSWERED" ? result.answerText : result?.status === "REFUSED" ? result.reason : null,
        citations: citations as unknown as Prisma.InputJsonValue,
        documentVersionIds: guides.map((g) => g.documentVersionId),
        model: result?.model ?? (reader.mode === "dev" ? "dev-reader" : "claude-opus-5-5"),
        promptVersion: PROMPT_VERSION,
        usage: (result?.usage ?? undefined) as Prisma.InputJsonValue | undefined,
        costUsd: result?.costUsd !== null && result?.costUsd !== undefined ? new Prisma.Decimal(result.costUsd.toFixed(4)) : null,
        error,
      },
    });
    await recordAudit(tx, ctx, { action: "guides.ask", entityType: "guide_question", entityId: row.id, after: { ...row, carrier: carrier.displayName } });
    return { ...row, carrier, guides, citations };
  });
}

export async function listRecentQuestions(ctx: AuthContext, opts: { organizationId?: string; take?: number } = {}) {
  assertCan(ctx, "guides.ask");
  return prisma.guideQuestion.findMany({
    where: opts.organizationId ? { organizationId: opts.organizationId } : {},
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 20, 100),
    include: { askedBy: { select: { name: true } }, organization: { select: { id: true, displayName: true } } },
  });
}

export async function getQuestion(ctx: AuthContext, id: string) {
  assertCan(ctx, "guides.ask");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Question not found.");
  const q = await prisma.guideQuestion.findUnique({ where: { id }, include: { askedBy: { select: { name: true } }, organization: { select: { id: true, displayName: true } } } });
  if (!q) throw new NotFoundError("Question not found.");
  const versions = await prisma.documentVersion.findMany({ where: { id: { in: q.documentVersionIds } }, select: { id: true, versionNumber: true, uploadedAt: true, document: { select: { id: true, title: true } } } });
  return { ...q, citations: q.citations as unknown as Citation[], guides: versions };
}
