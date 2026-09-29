-- กล่อง Gmail ที่ระบบได้รับอนุญาตให้อ่าน — ย้าย refresh token ออกจาก .env มาเก็บในฐานข้อมูล
-- เพิ่มตารางใหม่ล้วนๆ ไม่แตะของเดิม · ตราบใดที่ตารางนี้ยังว่าง ระบบยังอ่าน GMAIL_REFRESH_TOKEN
-- จาก .env ได้เหมือนเดิมทุกประการ (ดู lib/gmailClient.ts)
CREATE TABLE "gmail_connections" (
  "id"            SERIAL PRIMARY KEY,
  "email"         TEXT NOT NULL UNIQUE,
  "refresh_token" TEXT NOT NULL,
  "scopes"        TEXT,
  "is_active"     BOOLEAN NOT NULL DEFAULT false,
  "connected_by"  TEXT NOT NULL,
  "connected_at"  TEXT NOT NULL,
  "last_ok_at"    TEXT,
  "last_error"    TEXT,
  "last_error_at" TEXT
);

-- มีกล่องที่ใช้งานอยู่ได้ทีละหนึ่งเท่านั้น — บังคับที่ฐานข้อมูลเลย ไม่ใช่แค่ในโค้ด เพราะถ้าหลุดเป็นสองแถว
-- ระบบจะสลับกล่องไปมาแบบสุ่มโดยไม่มีใครรู้ ซึ่งไล่หาสาเหตุยากมาก
CREATE UNIQUE INDEX "gmail_connections_one_active" ON "gmail_connections" ("is_active") WHERE "is_active";
