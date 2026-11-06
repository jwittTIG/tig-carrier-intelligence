-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CHANGE_REQUEST_SUBMITTED', 'CHANGE_REQUEST_APPROVED', 'CHANGE_REQUEST_REJECTED', 'RECORD_APPROVED', 'INBOX_FILED', 'APPOINTMENT_EXPIRING', 'APPETITE_REVIEW_DUE');

-- CreateTable
CREATE TABLE "carrier_follows" (
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_follows_pkey" PRIMARY KEY ("user_id","organization_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_user_id" UUID NOT NULL,
    "event_type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "organization_id" UUID,
    "actor_user_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "carrier_follows_organization_id_idx" ON "carrier_follows"("organization_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_read_at_created_at_idx" ON "notifications"("recipient_user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_idx" ON "notifications"("organization_id");

-- CreateIndex
CREATE INDEX "notifications_actor_user_id_idx" ON "notifications"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipient_user_id_dedupe_key_key" ON "notifications"("recipient_user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "carrier_follows" ADD CONSTRAINT "carrier_follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_follows" ADD CONSTRAINT "carrier_follows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Links are app-relative only, never another site.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_href_relative" CHECK ("href" IS NULL OR ("href" LIKE '/%' AND "href" NOT LIKE '//%'));
