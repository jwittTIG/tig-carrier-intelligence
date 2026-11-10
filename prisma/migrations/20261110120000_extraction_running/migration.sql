-- A new guide version starts its AI read in the background (DECISIONS N24).
ALTER TYPE "ExtractionStatus" ADD VALUE 'RUNNING' BEFORE 'READY';
