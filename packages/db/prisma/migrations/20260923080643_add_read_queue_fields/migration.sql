-- AlterTable
ALTER TABLE "ai_reads" ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "requested_reader_id" TEXT,
ADD COLUMN     "requested_abbyy_skill_id" TEXT;

-- CreateIndex
CREATE INDEX "ai_reads_status_idx" ON "ai_reads"("status");
