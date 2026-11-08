-- CreateEnum
CREATE TYPE "GuideAnswerStatus" AS ENUM ('ANSWERED', 'REFUSED', 'FAILED');

-- CreateTable
CREATE TABLE "guide_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "asked_by" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "status" "GuideAnswerStatus" NOT NULL,
    "verdict" TEXT,
    "answer_text" TEXT,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "document_version_ids" UUID[],
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "usage" JSONB,
    "cost_usd" DECIMAL(10,4),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_document_files" (
    "document_version_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_document_files_pkey" PRIMARY KEY ("document_version_id")
);

-- CreateIndex
CREATE INDEX "guide_questions_organization_id_created_at_idx" ON "guide_questions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "guide_questions_asked_by_idx" ON "guide_questions"("asked_by");

-- CreateIndex
CREATE INDEX "guide_questions_created_at_idx" ON "guide_questions"("created_at");

-- AddForeignKey
ALTER TABLE "guide_questions" ADD CONSTRAINT "guide_questions_asked_by_fkey" FOREIGN KEY ("asked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_questions" ADD CONSTRAINT "guide_questions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_document_files" ADD CONSTRAINT "ai_document_files_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Verdicts are the AI's reading of a guide, from a fixed list (never an approved appetite outcome).
ALTER TABLE guide_questions ADD CONSTRAINT guide_questions_verdict_chk CHECK (verdict IS NULL OR verdict IN ('YES', 'NO', 'REFER', 'NOT_ADDRESSED', 'UNCLEAR'));
ALTER TABLE guide_questions ADD CONSTRAINT guide_questions_answered_chk CHECK (status <> 'ANSWERED' OR (verdict IS NOT NULL AND answer_text IS NOT NULL));
ALTER TABLE guide_questions ADD CONSTRAINT guide_questions_question_chk CHECK (char_length(question) BETWEEN 3 AND 1000);
