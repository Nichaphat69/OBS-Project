-- ฟิลด์จากใบเสนอราคา FlowAccount ที่ดึงมาเก็บเพิ่ม (5 ต.ค. 69) — เพิ่มคอลัมน์ล้วนๆ ทั้งหมด nullable (หรือมีค่าเริ่มต้น)
-- แถวเดิมไม่กระทบ ไม่ลบ ไม่แก้ข้อมูลเดิม
ALTER TABLE "customers" ADD COLUMN "zip_code" TEXT;

ALTER TABLE "contracts" ADD COLUMN "fa_reference" TEXT;
ALTER TABLE "contracts" ADD COLUMN "quotation_date" TEXT;
ALTER TABLE "contracts" ADD COLUMN "price_includes_vat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contracts" ADD COLUMN "sales_name" TEXT;
ALTER TABLE "contracts" ADD COLUMN "remarks" TEXT;
ALTER TABLE "contracts" ADD COLUMN "internal_notes" TEXT;
ALTER TABLE "contracts" ADD COLUMN "quotation_sub_total" DOUBLE PRECISION;
ALTER TABLE "contracts" ADD COLUMN "quotation_discount" DOUBLE PRECISION;
ALTER TABLE "contracts" ADD COLUMN "quotation_grand_total" DOUBLE PRECISION;

ALTER TABLE "assignments" ADD COLUMN "quantity" DOUBLE PRECISION;
ALTER TABLE "assignments" ADD COLUMN "unit_name" TEXT;
