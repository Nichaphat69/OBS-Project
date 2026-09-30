-- ไฟล์ Timesheet ที่ n8n ส่งเข้ามารอให้คนกดอ่านในแท็บ "ดึงจาก Gmail" — ตารางใหม่ล้วนๆ ไม่แตะของเดิม
CREATE TABLE "inbound_emails" (
  "id"              SERIAL PRIMARY KEY,
  "source_email_id" TEXT NOT NULL,
  "file_name"       TEXT NOT NULL,
  "file_key"        TEXT NOT NULL,
  "file_size"       INTEGER NOT NULL DEFAULT 0,
  "subject"         TEXT,
  "from_address"    TEXT,
  "body_text"       TEXT,
  "received_at"     TEXT,
  "created_at"      TEXT NOT NULL
);

-- n8n ส่งซ้ำได้ (poll ซ้อน, retry) — กันแถวซ้ำที่ฐานข้อมูลเลย ไม่ใช่แค่ในโค้ด
CREATE UNIQUE INDEX "inbound_emails_source_email_id_file_name_key" ON "inbound_emails" ("source_email_id", "file_name");
CREATE INDEX "inbound_emails_created_at_idx" ON "inbound_emails" ("created_at");
