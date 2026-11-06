-- CreateEnum
CREATE TYPE "MailSource" AS ENUM ('DEV', 'GRAPH');

-- CreateEnum
CREATE TYPE "SenderStatus" AS ENUM ('ACCEPTED', 'HELD', 'DISCARDED');

-- CreateEnum
CREATE TYPE "InboxStatus" AS ENUM ('NEW', 'TRIAGED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'EMAIL';

-- CreateTable
CREATE TABLE "inbound_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" "MailSource" NOT NULL,
    "mailbox" TEXT NOT NULL,
    "external_id" TEXT,
    "message_key" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "from_name" TEXT,
    "original_from" TEXT,
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "body_text" TEXT NOT NULL,
    "auth_results" TEXT,
    "sender_status" "SenderStatus" NOT NULL,
    "sender_user_id" UUID,
    "status" "InboxStatus" NOT NULL DEFAULT 'NEW',
    "organization_id" UUID,
    "raw_document_version_id" UUID NOT NULL,
    "triaged_by" UUID,
    "triaged_at" TIMESTAMPTZ(6),
    "dismiss_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "document_version_id" UUID,
    "rejected_reason" TEXT,

    CONSTRAINT "inbound_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_intake_state" (
    "mailbox" TEXT NOT NULL,
    "delta_link" TEXT,
    "last_run_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "last_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "mail_intake_state_pkey" PRIMARY KEY ("mailbox")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_message_key_key" ON "inbound_messages"("message_key");

-- CreateIndex
CREATE INDEX "inbound_messages_status_received_at_idx" ON "inbound_messages"("status", "received_at");

-- CreateIndex
CREATE INDEX "inbound_messages_sender_status_idx" ON "inbound_messages"("sender_status");

-- CreateIndex
CREATE INDEX "inbound_messages_organization_id_idx" ON "inbound_messages"("organization_id");

-- CreateIndex
CREATE INDEX "inbound_messages_sender_user_id_idx" ON "inbound_messages"("sender_user_id");

-- CreateIndex
CREATE INDEX "inbound_messages_triaged_by_idx" ON "inbound_messages"("triaged_by");

-- CreateIndex
CREATE INDEX "inbound_messages_raw_document_version_id_idx" ON "inbound_messages"("raw_document_version_id");

-- CreateIndex
CREATE INDEX "inbound_attachments_message_id_idx" ON "inbound_attachments"("message_id");

-- CreateIndex
CREATE INDEX "inbound_attachments_document_version_id_idx" ON "inbound_attachments"("document_version_id");

-- CreateIndex
CREATE INDEX "inbound_attachments_sha256_idx" ON "inbound_attachments"("sha256");

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_triaged_by_fkey" FOREIGN KEY ("triaged_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_raw_document_version_id_fkey" FOREIGN KEY ("raw_document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_attachments" ADD CONSTRAINT "inbound_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "inbound_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_attachments" ADD CONSTRAINT "inbound_attachments_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Checks (tests in tests/integration/inbox.test.ts) ──
ALTER TABLE inbound_messages ADD CONSTRAINT inbound_messages_sender_chk CHECK (sender_status <> 'ACCEPTED' OR sender_user_id IS NOT NULL);
ALTER TABLE inbound_messages ADD CONSTRAINT inbound_messages_triage_chk CHECK (status = 'NEW' OR (triaged_by IS NOT NULL AND triaged_at IS NOT NULL));
ALTER TABLE inbound_messages ADD CONSTRAINT inbound_messages_dismiss_chk CHECK (status <> 'DISMISSED' OR dismiss_reason IS NOT NULL);
ALTER TABLE inbound_attachments ADD CONSTRAINT inbound_attachments_outcome_chk CHECK ((document_version_id IS NULL) <> (rejected_reason IS NULL));
ALTER TABLE inbound_attachments ADD CONSTRAINT inbound_attachments_sha_chk CHECK (sha256 ~ '^[0-9a-f]{64}$' AND size_bytes >= 0);
