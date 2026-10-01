/**
 * ชี้ DATABASE_URL ไปฐานข้อมูลเทสต์ ก่อนที่ไฟล์เทสต์ไฟล์ไหนจะถูกโหลด
 *
 * โหลดผ่าน `node --import` ใน npm script ของ apps/api — ต้องมาก่อน import ใดๆ ที่ลาก `@obs/db`
 * เข้ามา เพราะ PrismaClient อ่าน DATABASE_URL ตอนสร้าง instance ครั้งแรกครั้งเดียว
 *
 * ค่าเริ่มต้นคือเติม "_test" ต่อท้ายชื่อฐานข้อมูลใน DATABASE_URL ปกติ (obs → obs_test) เพื่อไม่ต้อง
 * เก็บรหัสผ่านซ้ำอีกที่ — ตั้ง TEST_DATABASE_URL ถ้าอยากชี้ไปที่อื่น
 */

const explicit = process.env.TEST_DATABASE_URL;
if (explicit) {
  process.env.DATABASE_URL = explicit;
} else if (process.env.DATABASE_URL) {
  // postgresql://user:pass@host:port/<db>?params → .../<db>_test?params
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /\/([A-Za-z0-9_]+)(\?|$)/,
    (_all, db: string, tail: string) => `/${db.endsWith('_test') ? db : `${db}_test`}${tail}`,
  );
}

// ชุดเทสต์ใช้ที่เก็บไฟล์ในหน่วยความจำ ไม่ต้องมีคอนเทนเนอร์ storage รันอยู่ (ดู lib/fileStorage.ts)
process.env.STORAGE_DRIVER = 'memory';
