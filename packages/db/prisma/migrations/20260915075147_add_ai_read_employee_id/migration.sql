-- AlterTable
ALTER TABLE "ai_reads" ADD COLUMN     "employee_id" TEXT;

-- CreateIndex
CREATE INDEX "ai_reads_employee_id_idx" ON "ai_reads"("employee_id");

-- AddForeignKey
ALTER TABLE "ai_reads" ADD CONSTRAINT "ai_reads_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
