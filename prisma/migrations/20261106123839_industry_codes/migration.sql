-- CreateTable
CREATE TABLE "industry_codes" (
    "classification_system" "IndustryCodeSystem" NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "source_version" TEXT NOT NULL,

    CONSTRAINT "industry_codes_pkey" PRIMARY KEY ("classification_system","code")
);

-- Word search on titles ("roofing" -> Roofing Contractors).
CREATE INDEX industry_codes_title_trgm ON industry_codes USING gin (title gin_trgm_ops);
ALTER TABLE industry_codes ADD CONSTRAINT industry_codes_level_chk CHECK (level BETWEEN 1 AND 10);
