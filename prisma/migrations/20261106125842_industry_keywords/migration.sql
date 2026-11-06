-- CreateTable
CREATE TABLE "industry_keywords" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "classification_system" "IndustryCodeSystem" NOT NULL,
    "code" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "industry_keywords_keyword_trgm" ON "industry_keywords" USING GIN ("keyword" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "industry_keywords_created_by_idx" ON "industry_keywords"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "industry_keywords_classification_system_code_keyword_key" ON "industry_keywords"("classification_system", "code", "keyword");

-- AddForeignKey
ALTER TABLE "industry_keywords" ADD CONSTRAINT "industry_keywords_classification_system_code_fkey" FOREIGN KEY ("classification_system", "code") REFERENCES "industry_codes"("classification_system", "code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_keywords" ADD CONSTRAINT "industry_keywords_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stored trimmed and lowercase, 2-60 characters.
ALTER TABLE industry_keywords ADD CONSTRAINT industry_keywords_keyword_chk CHECK (keyword = lower(btrim(keyword)) AND char_length(keyword) BETWEEN 2 AND 60);
