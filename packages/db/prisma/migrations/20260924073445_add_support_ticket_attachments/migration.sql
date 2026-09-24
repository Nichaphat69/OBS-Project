-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "page_context" TEXT;

-- CreateTable
CREATE TABLE "support_ticket_attachments" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_bytes" BYTEA NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "support_ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_ticket_attachments_ticket_id_idx" ON "support_ticket_attachments"("ticket_id");

-- AddForeignKey
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
