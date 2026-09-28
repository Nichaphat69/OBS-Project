-- ที่อยู่ของไฟล์ใน storage container — คู่กับคอลัมน์ *_bytes เดิมที่ยังเขียนอยู่ทั้งคู่
-- nullable ทั้งหมด แถวเดิมจึงไม่กระทบ (ไม่มี key = ไฟล์ยังอยู่แค่ในฐานข้อมูล อ่านจาก bytea เหมือนเดิม)
ALTER TABLE "timesheets" ADD COLUMN "source_file_key" TEXT;
ALTER TABLE "ai_reads" ADD COLUMN "file_key" TEXT;
ALTER TABLE "invoices" ADD COLUMN "document_pdf_key" TEXT;
ALTER TABLE "support_ticket_attachments" ADD COLUMN "file_key" TEXT;
