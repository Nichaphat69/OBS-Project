/**
 * สร้างบัญชีผู้ใช้เข้าเว็บ OBS — เวอร์ชันสแตกใหม่ (Prisma/PostgreSQL)
 *
 * พอร์ตจาก scripts/create-user.js ซึ่ง import จาก src/auth.js ของระบบเก่าโดยตรง จึงใช้ไม่ได้อีก
 * หลังลบ src/ ทิ้งใน Phase 5.8 — นี่คือทางเดียวที่จะสร้างผู้ใช้คนแรกในระบบใหม่จากศูนย์
 * (หน้า "จัดการระบบ" สร้างผู้ใช้ได้ก็จริง แต่ต้องมีคนล็อกอินอยู่แล้วถึงจะเข้าหน้านั้นได้)
 *
 * รันแบบถามทีละคำ (เหมาะตอนนั่งอยู่หน้า terminal เอง):
 *   npm run user:create
 *
 * รันแบบระบุค่าตรงในคำสั่งเดียว (เหมาะตอนสั่งจากสคริปต์/เอเจนต์อื่น ไม่มี terminal โต้ตอบสด):
 *   npm run user:create -- <username> "<ชื่อที่โชว์ในบันทึก>" "<รหัสผ่าน>" [admin|accounting|user|executive]
 *   role ไม่ระบุ = user (ทำงานประจำวันได้ แก้ข้อมูลหลักไม่ได้)
 *
 * เก็บรหัสผ่านแบบ hash (scrypt) เท่านั้น ไม่มีที่ไหนในระบบเก็บรหัสผ่านตัวจริง
 * ⚠️ โหมดถามทีละคำ รหัสผ่านจะโชว์บนจอตอนพิมพ์ (terminal ธรรมดาไม่ได้ซ่อนให้) — อย่าพิมพ์ต่อหน้าคนอื่น
 */

import { createInterface } from 'node:readline';
import { prisma } from '@obs/db';
import { createUser, ROLES } from '../src/lib/usersService.js';

const [argUsername, argNameTh, argPassword, argRole] = process.argv.slice(2);

let username = argUsername;
let nameTh = argNameTh;
let password = argPassword;
let role = argRole;

if (!username || !nameTh || !password) {
  console.log('── สร้างบัญชีผู้ใช้เข้าเว็บ OBS ──\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

  username = (await ask('Username (ใช้ล็อกอิน เช่น nicha): ')).trim();
  nameTh = (await ask('ชื่อที่จะโชว์ในบันทึกทุกครั้งที่กดยืนยัน/อนุมัติ: ')).trim();
  password = (await ask('รหัสผ่าน (อย่างน้อย 8 ตัวอักษร — จะโชว์บนจอ อย่าพิมพ์ต่อหน้าคนอื่น): ')).trim();
  role = (await ask(`Role (${ROLES.join('/')}, ปล่อยว่าง = user): `)).trim();
  rl.close();
}

try {
  // actor 'cli' ตรงกับที่ระบบเก่าใช้เป็นค่าเริ่มต้นของงานที่สั่งจาก terminal — บันทึกลง audit_log
  // ให้รู้ว่าบัญชีนี้ไม่ได้ถูกสร้างผ่านหน้าเว็บโดยใครสักคน
  const user = await createUser({ username, nameTh, password, role: role || undefined, actor: 'cli' });
  console.log(`\nสร้างบัญชี "${user.username}" (${user.nameTh}, role: ${user.role}) เรียบร้อย — ล็อกอินที่หน้าเว็บได้เลย`);
} catch (error: any) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
