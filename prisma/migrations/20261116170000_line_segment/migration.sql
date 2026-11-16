-- Personal vs commercial lines, for grouping in pickers (Josh, 2026-11-16).
ALTER TABLE "lines_of_business" ADD COLUMN "segment" TEXT NOT NULL DEFAULT 'COMMERCIAL';
ALTER TABLE "lines_of_business" ADD CONSTRAINT lines_of_business_segment_chk CHECK (segment IN ('PERSONAL', 'COMMERCIAL'));
UPDATE "lines_of_business" SET "segment" = 'PERSONAL' WHERE "code" IN ('PERSONAL_HOME', 'PERSONAL_AUTO', 'PERSONAL_UMBRELLA', 'FLOOD');
