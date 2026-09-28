-- เลิกเก็บไฟล์เป็น binary ในฐานข้อมูล — ไฟล์ทั้งหมดอยู่ใน storage container แล้ว ตารางเหลือเก็บแค่ *_key
--
-- ทำได้เพราะตรวจแล้วว่าบนเครื่อง production ทั้งสี่ตารางไม่มีไฟล์เก็บอยู่เลยสักใบ (นับได้ 0 ทุกตาราง)
-- และเจ้าของระบบยืนยันเมื่อ 28 ก.ย. 69 ว่าข้อมูลที่มีอยู่เป็นข้อมูลตัวอย่างทั้งหมด
--
-- ⚠️ ถ้าเอา migration นี้ไปลงกับฐานข้อมูลที่มีไฟล์เก่าอยู่จริง ไฟล์เหล่านั้นจะหายถาวร
--    ต้องย้ายไฟล์ออกไป storage ให้ครบและตรวจว่าอ่านได้ทุกใบก่อน
ALTER TABLE "timesheets" DROP COLUMN "source_file_bytes";
ALTER TABLE "ai_reads" DROP COLUMN "file_bytes";
ALTER TABLE "invoices" DROP COLUMN "document_pdf";
ALTER TABLE "support_ticket_attachments" DROP COLUMN "file_bytes";
