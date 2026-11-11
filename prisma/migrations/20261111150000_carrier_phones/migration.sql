-- Carrier main, billing and claims phone numbers (Josh, 2026-11-11: Carrier SnapShot).
ALTER TABLE "organizations" ADD COLUMN "main_phone" TEXT, ADD COLUMN "billing_phone" TEXT, ADD COLUMN "claims_phone" TEXT;
