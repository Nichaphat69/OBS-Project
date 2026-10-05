-- ช่องที่ "ดึงมาจาก FlowAccount" ตอนสร้างสัญญา แก้เองไม่ได้ (5 ต.ค. 69) — เก็บเป็น JSON array ของชื่อช่อง
-- เพิ่มคอลัมน์ล้วนๆ nullable แถวเดิมไม่กระทบ (null = สัญญาที่สร้างก่อนมีฟีเจอร์นี้ ใช้กฎสำรองฝั่ง server)
ALTER TABLE "contracts" ADD COLUMN "fa_locked_fields" TEXT;
