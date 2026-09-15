/**
 * เตรียมฐานข้อมูลเทสต์ให้พร้อมรัน — สร้าง `<db>_test` ถ้ายังไม่มี แล้ว migrate schema ลงไป
 *
 * รันครั้งเดียวก่อนรันเทสต์ครั้งแรก (หรือหลังเพิ่ม migration ใหม่):  npm run test:db:setup -w @obs/api
 * ต้องมี Postgres ขึ้นอยู่แล้ว (docker compose up postgres)
 *
 * ใช้ `prisma db execute` แทนไคลเอนต์ Postgres ตรงๆ เพื่อไม่ต้องเพิ่ม dependency ใหม่แค่สำหรับ
 * คำสั่ง CREATE DATABASE คำสั่งเดียว
 */
import { execFileSync } from 'node:child_process';

const source = process.env.DATABASE_URL;
if (!source) throw new Error('ต้องตั้ง DATABASE_URL ก่อน (ปกติอยู่ใน .env ที่ราก repo)');

const SCHEMA = '../../packages/db/prisma/schema.prisma';

const url = new URL(source);
const sourceDb = url.pathname.replace(/^\//, '');
const testDb = sourceDb.endsWith('_test') ? sourceDb : `${sourceDb}_test`;
// identifier ใส่เป็น parameter ไม่ได้ จึงคุมด้วย allowlist ตัวอักษรก่อนต่อเป็นสตริง SQL
if (!/^[A-Za-z0-9_]+$/.test(testDb)) throw new Error(`ชื่อฐานข้อมูลเทสต์ไม่ถูกต้อง: ${testDb}`);

const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const testUrl = new URL(source);
testUrl.pathname = `/${testDb}`;

try {
  execFileSync('npx', ['prisma', 'db', 'execute', '--url', adminUrl.toString(), '--stdin', '--schema', SCHEMA], {
    input: `CREATE DATABASE "${testDb}"`,
    stdio: ['pipe', 'inherit', 'pipe'],
  });
  console.log(`สร้างฐานข้อมูล ${testDb} แล้ว`);
} catch (error: any) {
  const detail = String(error?.stderr ?? error?.message ?? '');
  if (!detail.includes('already exists')) throw error;
  console.log(`มีฐานข้อมูล ${testDb} อยู่แล้ว`);
}

execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', SCHEMA], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: testUrl.toString() },
});
