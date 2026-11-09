-- AlterTable
ALTER TABLE "guide_questions" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'FULL_PDF',
ADD COLUMN     "pages_sent" JSONB;

-- CreateTable
CREATE TABLE "document_pages" (
    "document_version_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("document_version_id","page_number")
);

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE guide_questions ADD CONSTRAINT guide_questions_mode_chk CHECK (mode IN ('PAGES', 'FULL_PDF'));
ALTER TABLE document_pages ADD CONSTRAINT document_pages_number_chk CHECK (page_number >= 1);
