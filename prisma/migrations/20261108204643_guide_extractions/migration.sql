-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('READY', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "guide_extractions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_version_id" UUID NOT NULL,
    "carrier_product_id" UUID NOT NULL,
    "status" "ExtractionStatus" NOT NULL,
    "proposals" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "profile_id" UUID,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "usage" JSONB,
    "cost_usd" DECIMAL(10,4),
    "error" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(6),

    CONSTRAINT "guide_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guide_extractions_document_version_id_idx" ON "guide_extractions"("document_version_id");

-- CreateIndex
CREATE INDEX "guide_extractions_carrier_product_id_created_at_idx" ON "guide_extractions"("carrier_product_id", "created_at");

-- CreateIndex
CREATE INDEX "guide_extractions_created_by_idx" ON "guide_extractions"("created_by");

-- AddForeignKey
ALTER TABLE "guide_extractions" ADD CONSTRAINT "guide_extractions_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_extractions" ADD CONSTRAINT "guide_extractions_carrier_product_id_fkey" FOREIGN KEY ("carrier_product_id") REFERENCES "carrier_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_extractions" ADD CONSTRAINT "guide_extractions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An applied extraction points at the draft it filled; a failed one says why.
ALTER TABLE guide_extractions ADD CONSTRAINT guide_extractions_status_chk CHECK (
  (status <> 'APPLIED' OR (profile_id IS NOT NULL AND applied_at IS NOT NULL)) AND
  (status <> 'FAILED' OR error IS NOT NULL)
);
